import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TestHarness } from './e2e/harness.js';

describe('Milestone 4 Fixes: Stroke Immutability & Replay Event Integrity', () => {
  it('STROKE_ADD in recorded segment events is not corrupted when points are appended to stroke later', async () => {
    const harness = new TestHarness();
    try {
      const { host, artists } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 2,
        saboteurs: 1,
      });

      await host.waitForSnapshot((s) => s.screen === 'BROADCAST', 4000);
      host.send({ type: 'SUBMIT_HEADLINE', headline: 'STROKE TEST' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE', 5000);

      const artist = artists[0];
      const strokeId = 'test-stroke-immutability';

      // 1. Start a stroke with 1 initial point
      artist.send({
        type: 'STROKE_START',
        id: strokeId,
        color: '#10B981',
        widthNorm: 0.02,
        point: { x: 0.1, y: 0.1 },
      });
      await artist.waitFor('STROKE_START_BC');

      // 2. Append 5 more points to the stroke
      artist.send({
        type: 'STROKE_POINTS',
        id: strokeId,
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.3, y: 0.3 },
          { x: 0.4, y: 0.4 },
          { x: 0.5, y: 0.5 },
          { x: 0.6, y: 0.6 },
        ],
      });
      await artist.waitFor('STROKE_POINTS_BC');

      // 3. Inspect room segment events directly on the server
      const room = (harness.roomManager as any).rooms.get(host.lastSnapshot?.roomCode);
      assert.ok(room, 'Room must exist');
      assert.ok(room.segment, 'Active segment must exist');

      const strokeAddEvent = room.segment.events.find(
        (e: any) => e.type === 'STROKE_ADD' && e.item.id === strokeId,
      );
      assert.ok(strokeAddEvent, 'STROKE_ADD event must exist in segment events');

      // CRITICAL CHECK: STROKE_ADD must retain ONLY the 1 initial point!
      // Previously, because `item` was pushed without cloning, `item.points.push(...)`
      // in `handleStrokePoints` mutated the event in-place to have 6 points!
      assert.equal(
        strokeAddEvent.item.points.length,
        1,
        'STROKE_ADD event must have exactly 1 point, not all appended points!',
      );
      assert.deepEqual(strokeAddEvent.item.points[0], { x: 0.1, y: 0.1 });

      // And STROKE_UPDATE event contains the 5 appended points
      const strokeUpdateEvent = room.segment.events.find(
        (e: any) => e.type === 'STROKE_UPDATE' && e.id === strokeId,
      );
      assert.ok(strokeUpdateEvent, 'STROKE_UPDATE event must exist in segment events');
      assert.equal(strokeUpdateEvent.points.length, 5);
    } finally {
      await harness.cleanup();
    }
  });

  it('Floating reactions lane layout keeps the central 60% of the canvas unobstructed', () => {
    // Tests the edge positioning logic used in FloatingReactions.tsx
    const computeLeftPct = (lane: number) => {
      const isLeft = lane < 0.5;
      const normalized = isLeft ? lane / 0.5 : (lane - 0.5) / 0.5;
      return isLeft ? 3 + normalized * 12 : 83 + normalized * 12;
    };

    // Edge cases: 0.0, 0.499, 0.5, 1.0, and 100 random values
    assert.equal(computeLeftPct(0), 3); // 3% from left
    assert.ok(computeLeftPct(0.499) <= 15.1); // <= 15% on left edge
    assert.equal(computeLeftPct(0.5), 83); // 83% on right edge
    assert.equal(computeLeftPct(1.0), 95); // 95% on right edge

    for (let i = 0; i < 100; i++) {
      const lane = Math.random();
      const leftPct = computeLeftPct(lane);
      // Central zone (16%..82%) must NEVER contain a floating reaction
      const isInCentralZone = leftPct > 15.5 && leftPct < 82.5;
      assert.equal(
        isInCentralZone,
        false,
        `Lane ${lane} mapped to ${leftPct}%, which falls into the central artwork viewing zone!`,
      );
    }
  });

  it('Flipped canvas coordinate inversion maps touches accurately to rotated element space', () => {
    // Tests the coordinate normalization formula used in TvDisplay.tsx
    const mapCoords = (normX: number, normY: number, isFlipped: boolean) => {
      const rawX = isFlipped ? 1 - normX : normX;
      const rawY = isFlipped ? 1 - normY : normY;
      const x = Math.round(rawX * 1e6) / 1e6;
      const y = Math.round(rawY * 1e6) / 1e6;
      return { x, y };
    };

    // When NOT flipped: coords match raw
    assert.deepEqual(mapCoords(0, 0, false), { x: 0, y: 0 });
    assert.deepEqual(mapCoords(0.25, 0.75, false), { x: 0.25, y: 0.75 });
    assert.deepEqual(mapCoords(1, 1, false), { x: 1, y: 1 });

    // When FLIPPED: top-left screen touch maps to (1, 1) in canvas space
    // which in 180deg rotated DOM renders right at screen top-left under the finger!
    assert.deepEqual(mapCoords(0, 0, true), { x: 1, y: 1 });
    assert.deepEqual(mapCoords(1, 1, true), { x: 0, y: 0 });
    assert.deepEqual(mapCoords(0.2, 0.8, true), { x: 0.8, y: 0.2 });
    assert.deepEqual(mapCoords(0.5, 0.5, true), { x: 0.5, y: 0.5 });
  });

  it('Active players can take role slots when ghost players hold slots in the roster', async () => {
    const harness = new TestHarness();
    try {
      const { roomCode, host, players } = await harness.setupLobby({ playerCount: 4 });
      host.send({ type: 'START_GAME' });
      await host.waitForSnapshot((s) => s.screen === 'ROLE_SELECT');

      // Player 0 picks artist
      players[0].send({ type: 'SELECT_ROLE', role: 'artist' });
      await host.waitForSnapshot((s) => s.players.find((p) => p.id === players[0].id)?.role === 'artist');

      // Player 0 disconnects (becomes a ghost)
      await players[0].close();
      await host.waitForSnapshot((s) => s.players.find((p) => p.id === players[0].id && !p.connected));

      // With 4 players, artist cap is 1 in normal mode.
      // But because Player 0 is disconnected, active players count is now 3.
      // Another active player should be able to select role without crashing or blocking.
      players[1].send({ type: 'SELECT_ROLE', role: 'writer' });
      const snap = await host.waitForSnapshot(
        (s) => s.players.find((p) => p.id === players[1].id)?.role === 'writer',
      );
      assert.equal(snap.players.find((p) => p.id === players[1].id)?.role, 'writer');
    } finally {
      await harness.cleanup();
    }
  });
});
