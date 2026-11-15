import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeTotalSegments,
  isAbilityId,
  isRole,
  isSaboteurClass,
} from '../shared/constants.js';
import { TestClient, TestHarness } from './e2e/harness.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('Regression: socket identity on reconnect', () => {
  it('a late close of the replaced socket must not disconnect the live player', async () => {
    const harness = new TestHarness();
    try {
      const host = await harness.createClient('Host');
      const hostSnap = await host.createRoom('Host');
      const p1 = await harness.createClient('P1');
      await p1.joinRoom(hostSnap.roomCode, 'P1');
      const playerId = p1.id;
      const token = p1.token;

      // Same player opens a second connection with the session token.
      const p2 = await harness.createClient('P1-second');
      p2.send({ type: 'RECONNECT', roomCode: hostSnap.roomCode, token });
      await p2.waitFor('WELCOME');

      // The server must retire the previous socket instead of keeping both alive.
      await p1.close();
      await sleep(60);
      assert.equal(p1.rawSocket.readyState, 3, 'Old socket must be closed by the server');

      const sawDisconnect = await host
        .waitForSnapshot((s) => s.players.some((p) => p.id === playerId && !p.connected), 300)
        .then(() => true)
        .catch(() => false);
      assert.equal(sawDisconnect, false, 'Reconnected player must stay marked as connected');
    } finally {
      await harness.cleanup();
    }
  });

  it('reuses ghost seats instead of growing the roster, and lets a newcomer join', async () => {
    const harness = new TestHarness();
    try {
      const host = await harness.createClient('Host');
      const hostSnap = await host.createRoom('Host');
      const roomCode = hostSnap.roomCode;
      const players: TestClient[] = [];
      for (let i = 0; i < 9; i++) {
        const client = await harness.createClient(`P${i + 1}`);
        await client.joinRoom(roomCode, `P${i + 1}`);
        players.push(client);
      }
      await host.waitForSnapshot((s) => s.players.length === 10);

      for (let cycle = 0; cycle < 3; cycle++) {
        const leaving = players[players.length - 1];
        await leaving.close();
        await host.waitForSnapshot(
          (s) => s.players.some((p) => p.id === leaving.id && !p.connected),
          2000,
        );

        const late = await harness.createClient(`Late${cycle}`);
        const welcome = await late.joinRoom(roomCode, `Late${cycle}`);
        players[players.length - 1] = late;

        assert.equal(
          welcome.players.length,
          10,
          'Roster must stay capped at MAX_PLAYERS (ghost seat is reused)',
        );
        assert.equal(
          welcome.players.filter((p) => p.connected).length,
          10,
          'A new player must be able to take the freed seat',
        );
        const room = (harness.roomManager as any).rooms.get(roomCode);
        assert.equal(room.players.length, 10, 'Ghost seats must not accumulate');
      }
    } finally {
      await harness.cleanup();
    }
  });
});

describe('Regression: untrusted client input validation', () => {
  it('rejects unknown roles and saboteur classes even in test mode', async () => {
    const harness = new TestHarness();
    try {
      const { host } = await harness.setupLobby({ playerCount: 4, testMode: true });
      host.send({ type: 'START_GAME' });
      await host.waitForSnapshot((s) => s.screen === 'ROLE_SELECT');

      const before = await host.waitForSnapshot((s) => s.screen === 'ROLE_SELECT');
      assert.equal(before.players.find((p) => p.id === host.id)?.role, null);

      host.send({ type: 'SELECT_ROLE', role: 'admin' } as any);
      const roleError = await host.waitFor('ERROR');
      assert.match(roleError.message, /роль/i);
      assert.equal(
        host.lastSnapshot?.players.find((p) => p.id === host.id)?.role,
        null,
        'Invalid role must not be stored',
      );

      host.send({ type: 'SELECT_ROLE', role: 'saboteur' });
      const afterRole = await host.waitForSnapshot(
        (s) => s.players.find((p) => p.id === host.id)?.role === 'saboteur',
      );
      assert.equal(afterRole.players.find((p) => p.id === host.id)?.saboteurClass, 'vandal');

      host.send({ type: 'SELECT_SABOTEUR_CLASS', saboteurClass: 'godmode' } as any);
      const classError = await host.waitFor('ERROR');
      assert.match(classError.message, /класс/i);
      assert.equal(
        host.lastSnapshot?.players.find((p) => p.id === host.id)?.saboteurClass,
        'vandal',
        'Invalid saboteur class must not be stored',
      );
    } finally {
      await harness.cleanup();
    }
  });

  it('clamps stroke width, ignores malformed strokes and invalid emoji do not eat the rate limit', async () => {
    const harness = new TestHarness();
    try {
      const { host, artists, saboteurs } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 2,
        saboteurs: 1,
      });
      await host.waitForSnapshot((s) => s.screen === 'BROADCAST', 4000);

      host.send({ type: 'SUBMIT_HEADLINE', headline: 'STRESS' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE', 5000);

      const artist = artists[0];

      // A huge width must be clamped to the forced-brush ceiling.
      artist.send({
        type: 'STROKE_START',
        id: 'wide',
        color: '#EF4444',
        widthNorm: 5,
        point: { x: 0.5, y: 0.5 },
      });
      const wide = await host.waitFor('STROKE_START_BC');
      assert.ok(
        wide.item.widthNorm > 0 && wide.item.widthNorm <= 0.075,
        `widthNorm must be clamped to the brush ceiling, got ${wide.item.widthNorm}`,
      );

      host.drainMessages();

      // Malformed payloads must be rejected without throwing / broadcasting.
      artist.send({ type: 'STROKE_START', id: 'no-point', color: '#EF4444' } as any);
      artist.send({
        type: 'STROKE_POINTS',
        id: 'wide',
        points: [null, { x: 'nope', y: 1 }],
      } as any);
      await assert.rejects(host.waitFor('STROKE_START_BC', undefined, 250));
      await assert.rejects(host.waitFor('STROKE_POINTS_BC', undefined, 250));

      // An invalid emoji must not consume the 250 ms anti-flood budget.
      const sab = saboteurs[0];
      sab.send({ type: 'SEND_REACTION', emoji: 'plain text' });
      sab.send({ type: 'SEND_REACTION', emoji: '😂' });
      const reaction = await sab.waitFor('REACTION_BC', undefined, 1000);
      assert.equal(reaction.emoji, '😂');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('Regression: leaving a room', () => {
  it('LEAVE_ROOM removes the player from the lobby and migrates host status', async () => {
    const harness = new TestHarness();
    try {
      const { host, players } = await harness.setupLobby({ playerCount: 3 });
      host.send({ type: 'LEAVE_ROOM' });
      const snap = await players[0].waitForSnapshot(
        (s) => s.players.length === 2 && !s.players.some((p) => p.id === host.id),
      );
      assert.equal(snap.players.length, 2, 'Leaving player must be removed from the lobby');
      assert.ok(
        snap.players.some((p) => p.id === players[0].id && p.isHost),
        'Host status must migrate to the next connected human',
      );
      assert.notEqual(snap.hostId, host.id);

      host.send({ type: 'RETURN_TO_LOBBY' });
      const err = await host.waitFor('ERROR');
      assert.match(err.message, /не подключены/i);
    } finally {
      await harness.cleanup();
    }
  });
});

describe('Regression: room lifecycle edge cases', () => {
  it('ADD_BOT never grows the roster past MAX_PLAYERS', async () => {
    const harness = new TestHarness();
    try {
      const { roomCode, host, players } = await harness.setupLobby({ playerCount: 10 });
      const room = (harness.roomManager as any).rooms.get(roomCode);
      const botsBefore = room.players.filter((p: any) => p.isBot).length;

      for (let cycle = 0; cycle < 5; cycle++) {
        const leaving = players[cycle];
        await leaving.close();
        await host.waitForSnapshot(
          (s) => s.players.some((p) => p.id === leaving.id && !p.connected),
          2000,
        );
        host.send({ type: 'ADD_BOT' });
        await sleep(20);
      }

      assert.equal(room.players.length, 10, 'Roster must stay at MAX_PLAYERS');
      assert.equal(
        room.players.filter((p: any) => p.isBot).length,
        botsBefore,
        'No bot may be added while the roster is full',
      );
    } finally {
      await harness.cleanup();
    }
  });

  it('a newcomer recovers a room whose host seat is a ghost', async () => {
    const harness = new TestHarness();
    try {
      const host = await harness.createClient('Host');
      const hostSnap = await host.createRoom('Host');
      const roomCode = hostSnap.roomCode;
      host.send({ type: 'TOGGLE_TEST_MODE', enabled: true });
      await host.waitForSnapshot((s) => s.testMode === true);

      const others: TestClient[] = [];
      for (let i = 0; i < 9; i++) {
        const client = await harness.createClient(`P${i}`);
        await client.joinRoom(roomCode, `P${i}`);
        others.push(client);
      }
      await host.waitForSnapshot((s) => s.players.length === 10);

      // Everyone leaves; the host seat becomes a ghost and the room has no host online.
      for (const client of others) await client.close();
      await host.close();
      await sleep(30);

      const newcomer = await harness.createClient('Newcomer');
      const welcome = await newcomer.joinRoom(roomCode, 'Newcomer');
      assert.ok(
        welcome.players.some((p) => p.id === newcomer.id && p.isHost),
        'The newcomer must take over the vacant host seat',
      );

      const room = (harness.roomManager as any).rooms.get(roomCode);
      assert.ok(
        room.players.some((p: any) => p.id === room.hostId),
        'hostId must reference an existing player',
      );
      assert.equal(room.players.filter((p: any) => p.isHost).length, 1);

      // The room is playable again.
      newcomer.send({ type: 'START_GAME' });
      await newcomer.waitForSnapshot((s) => s.screen === 'ROLE_SELECT', 2000);
    } finally {
      await harness.cleanup();
    }
  });

  it('RECONNECT to another room releases the seat instead of leaving a connected ghost', async () => {
    const harness = new TestHarness();
    try {
      const client = await harness.createClient('Multi');
      const token = 'shared-token-1';
      client.send({ type: 'CREATE_ROOM', playerName: 'A', token });
      const roomA = await client.waitFor('WELCOME');
      client.drainMessages();

      client.send({ type: 'CREATE_ROOM', playerName: 'B', token });
      const roomB = await client.waitFor('WELCOME');
      client.drainMessages();

      client.send({ type: 'RECONNECT', roomCode: roomA.snapshot.roomCode, token });
      const back = await client.waitFor('WELCOME');
      assert.equal(back.playerId, roomA.playerId, 'Session in room A must be restored');

      const bRoom = (harness.roomManager as any).rooms.get(roomB.snapshot.roomCode);
      const bPlayer = bRoom.players.find((p: any) => p.id === roomB.playerId);
      assert.equal(bPlayer.connected, false, 'Seat in the previous room B must be released');
      assert.equal(bPlayer.ws, null);

      const aRoom = (harness.roomManager as any).rooms.get(roomA.snapshot.roomCode);
      const aPlayer = aRoom.players.find((p: any) => p.id === roomA.playerId);
      assert.equal(aPlayer.connected, true);
    } finally {
      await harness.cleanup();
    }
  });

  it('JOIN_ROOM with the own token on the same socket keeps host status', async () => {
    const harness = new TestHarness();
    try {
      // A second connected player makes a lost host seat visible: without the
      // same-binding check the server detaches first and promotes that player.
      const { host } = await harness.setupLobby({ playerCount: 2 });
      const before = await host.waitForSnapshot((s) => s.players.length === 2);
      host.drainMessages();

      host.send({
        type: 'JOIN_ROOM',
        roomCode: before.roomCode,
        playerName: 'Host',
        token: host.token,
      });
      const welcome = await host.waitFor('WELCOME');

      assert.equal(welcome.playerId, host.id, 'Same player must be kept');
      assert.equal(welcome.snapshot.hostId, host.id, 'Host must not be demoted by re-joining');
      assert.equal(welcome.snapshot.players.length, 2, 'No duplicate player may be created');
      const room = (harness.roomManager as any).rooms.get(before.roomCode);
      assert.equal(room.players.filter((p: any) => p.isHost).length, 1);
      assert.equal(room.hostId, host.id);
    } finally {
      await harness.cleanup();
    }
  });

  it('CREATE_ROOM from a socket already in a room releases the old seat', async () => {
    const harness = new TestHarness();
    try {
      const host = await harness.createClient('Host');
      const firstRoom = await host.createRoom('Host');
      const p1 = await harness.createClient('P1');
      await p1.joinRoom(firstRoom.roomCode, 'P1');
      const oldPlayerId = p1.id;
      p1.drainMessages();

      p1.send({ type: 'CREATE_ROOM', playerName: 'P1-new' });
      const welcome = await p1.waitFor('WELCOME');
      assert.notEqual(welcome.snapshot.roomCode, firstRoom.roomCode);
      assert.notEqual(welcome.playerId, oldPlayerId);

      const oldRoom = (harness.roomManager as any).rooms.get(firstRoom.roomCode);
      const oldPlayer = oldRoom.players.find((p: any) => p.id === oldPlayerId);
      assert.equal(oldPlayer.connected, false, 'Old seat must not stay "connected"');
      assert.equal(oldPlayer.ws, null, 'Old seat must not keep the socket reference');
    } finally {
      await harness.cleanup();
    }
  });

  it('LEAVE_ROOM never leaves the room without a host', async () => {
    const harness = new TestHarness();
    try {
      const { roomCode, host, players } = await harness.setupLobby({ playerCount: 4 });
      for (const player of players) {
        await player.close();
      }

      host.send({ type: 'LEAVE_ROOM' });
      await sleep(30);

      const room = (harness.roomManager as any).rooms.get(roomCode);
      assert.ok(room, 'Room must stay while humans still own seats');
      assert.equal(room.players.length, 3, 'Only the leaving host is removed');
      assert.ok(
        room.players.some((p: any) => p.id === room.hostId),
        'hostId must reference an existing player',
      );
      assert.equal(
        room.players.filter((p: any) => p.isHost).length,
        1,
        'Exactly one host must remain',
      );

      // The elected host is a disconnected human: reconnecting keeps the seat.
      const reconnected = await harness.createClient('P1-return');
      const snap = await reconnected.reconnect(roomCode, players[0].token);
      assert.equal(snap.screen, 'LOBBY');
      assert.equal(snap.hostId, players[0].id, 'Returning host must keep host status');
      assert.ok(snap.players.some((p) => p.id === players[0].id && p.isHost));
    } finally {
      await harness.cleanup();
    }
  });

  it('a player who missed ROLE_SELECT gets a usable role on mid-game reconnect', async () => {
    const harness = new TestHarness();
    try {
      const { roomCode, host, players } = await harness.setupLobby({ playerCount: 4 });
      host.send({ type: 'START_GAME' });
      await host.waitForSnapshot((s) => s.screen === 'ROLE_SELECT');

      host.send({ type: 'SELECT_ROLE', role: 'writer' });
      players[0].send({ type: 'SELECT_ROLE', role: 'artist' });
      players[1].send({ type: 'SELECT_ROLE', role: 'artist' });

      const missing = players[2];
      const missingId = missing.id;
      const missingToken = missing.token;
      await missing.close();

      // The disconnect itself must fast-forward the role select (no 15s stall).
      await host.waitForSnapshot((s) => s.screen === 'BROADCAST', 4000);

      const returning = await harness.createClient('P4-return');
      const snap = await returning.reconnect(roomCode, missingToken);
      const player = snap.players.find((p) => p.id === missingId);
      assert.ok(player, 'Returning player must be restored');
      assert.notEqual(player.role, null, 'Returning player must get a role instead of a dead console');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('Regression: shared helpers', () => {
  it('validates roles, saboteur classes and abilities', () => {
    assert.equal(isRole('writer'), true);
    assert.equal(isRole('admin'), false);
    assert.equal(isRole(null), false);

    assert.equal(isSaboteurClass('hacker'), true);
    assert.equal(isSaboteurClass('godmode'), false);

    assert.equal(isAbilityId('tomato'), true);
    assert.equal(isAbilityId('nuke'), false);
  });

  it('computes segment count as max(3, writers)', () => {
    assert.equal(computeTotalSegments(0), 3);
    assert.equal(computeTotalSegments(2), 3);
    assert.equal(computeTotalSegments(3), 3);
    assert.equal(computeTotalSegments(5), 5);
  });
});
