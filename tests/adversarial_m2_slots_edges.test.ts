import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TestHarness } from './e2e/harness.js';
import {
  ABILITIES,
  computeRoleSlots,
  ENERGY,
  FALLBACK_HEADLINES,
  FORCED_BRUSH,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TIMINGS,
  type Role,
  type SaboteurClass,
} from '../shared/constants.js';
import {
  canTakeRole,
  countTakenRoles,
  finalizePlayerRoles,
  randomSaboteurClass,
} from '../server/roleAllocator.js';
import type { PlayerInfo } from '../shared/protocol.js';

async function flushAsync(count = 5): Promise<void> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

describe('Adversarial Stress Test: Milestone 2 State Machine & Edge Cases', () => {
  // =========================================================================
  // 1. Slot Limit Adherence Matrix & Fallback Order Generator
  // =========================================================================
  describe('1. Exhaustive Slot Limit Adherence & Fallback Order Oracle', () => {
    it('verifies slot sum strictly equals player count N for all N in [4, 10]', () => {
      for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
        const slots = computeRoleSlots(n, false);
        const sum = slots.writer + slots.artist + slots.saboteur;
        assert.equal(
          sum,
          n,
          `Slot sum (${sum}) must exactly equal player count (${n}) in computeRoleSlots`,
        );
        assert.ok(slots.writer >= 1, `Player count ${n} must have at least 1 writer`);
        assert.ok(slots.artist >= 2, `Player count ${n} must have at least 2 artists`);
        assert.ok(slots.saboteur >= 1, `Player count ${n} must have at least 1 saboteur`);
      }
    });

    it('generates 700 randomized role-choice configurations and verifies strict fallback order (writer -> artist -> saboteur)', () => {
      const rolesOrder: Role[] = ['writer', 'artist', 'saboteur'];

      for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
        const limits = computeRoleSlots(n, false);

        for (let iteration = 0; iteration < 100; iteration++) {
          const players: PlayerInfo[] = Array.from({ length: n }, (_, i) => ({
            id: `player-${n}-${iteration}-${i}`,
            name: `Player ${i}`,
            isHost: i === 0,
            isBot: false,
            connected: true,
            role: null,
            saboteurClass: null,
            energy: ENERGY.START,
            wipersCooldownUntil: 0,
          }));

          // Randomly assign valid roles to a random subset of players
          const currentCounts: Record<Role, number> = { writer: 0, artist: 0, saboteur: 0 };
          for (const p of players) {
            // 50% chance player picks a role if available
            if (Math.random() < 0.5) {
              const availableRoles = rolesOrder.filter((r) => currentCounts[r] < limits[r]);
              if (availableRoles.length > 0) {
                const chosen = availableRoles[Math.floor(Math.random() * availableRoles.length)];
                p.role = chosen;
                currentCounts[chosen]++;
                if (chosen === 'saboteur') {
                  p.saboteurClass = randomSaboteurClass();
                }
              }
            }
          }

          // Count how many were unassigned
          const unassignedIndices = players
            .map((p, idx) => (p.role === null ? idx : -1))
            .filter((idx) => idx !== -1);

          // Calculate how many remaining slots of each role are needed
          const remainingWriter = limits.writer - currentCounts.writer;
          const remainingArtist = limits.artist - currentCounts.artist;
          const remainingSaboteur = limits.saboteur - currentCounts.saboteur;

          // Run finalizePlayerRoles
          finalizePlayerRoles(players, false);

          // Verify total counts match limits exactly
          const finalCounts = countTakenRoles(players);
          assert.deepEqual(
            finalCounts,
            limits,
            `Iteration ${iteration} for N=${n}: Final counts ${JSON.stringify(finalCounts)} must match limits ${JSON.stringify(limits)}`,
          );

          // Verify that unassigned players were filled in strict order:
          // first remainingWriter unassigned got 'writer',
          // next remainingArtist unassigned got 'artist',
          // last remainingSaboteur unassigned got 'saboteur'.
          let uIdx = 0;
          for (let w = 0; w < remainingWriter; w++, uIdx++) {
            const playerIdx = unassignedIndices[uIdx];
            assert.equal(
              players[playerIdx].role,
              'writer',
              `Unassigned player at idx ${playerIdx} must be assigned writer`,
            );
            assert.equal(players[playerIdx].saboteurClass, null);
          }
          for (let a = 0; a < remainingArtist; a++, uIdx++) {
            const playerIdx = unassignedIndices[uIdx];
            assert.equal(
              players[playerIdx].role,
              'artist',
              `Unassigned player at idx ${playerIdx} must be assigned artist`,
            );
            assert.equal(players[playerIdx].saboteurClass, null);
          }
          for (let s = 0; s < remainingSaboteur; s++, uIdx++) {
            const playerIdx = unassignedIndices[uIdx];
            assert.equal(
              players[playerIdx].role,
              'saboteur',
              `Unassigned player at idx ${playerIdx} must be assigned saboteur`,
            );
            assert.ok(
              ['vandal', 'hacker', 'director'].includes(players[playerIdx].saboteurClass as any),
              `Saboteur must have valid class, got ${players[playerIdx].saboteurClass}`,
            );
          }
        }
      }
    });

    it('empirically verifies slot cap rejection across 4, 6, 8, and 10 players in RoomManager', async (t) => {
      const harness = new TestHarness();
      try {
        for (const playerCount of [4, 6, 8, 10]) {
          const { host, players } = await harness.setupLobby({ playerCount, testMode: false });
          host.send({ type: 'START_GAME' });
          await host.waitForSnapshot((s) => s.screen === 'ROLE_SELECT');

          const limits = computeRoleSlots(playerCount, false);
          const allClients = [host, ...players];

          // Fill all writer slots
          for (let i = 0; i < limits.writer; i++) {
            allClients[i].send({ type: 'SELECT_ROLE', role: 'writer' });
            await host.waitForSnapshot(
              (s) => s.players.find((p) => p.id === allClients[i].id)?.role === 'writer',
            );
          }

          // Next player attempts to select writer -> must receive ERROR and role remains null
          const overflowClient = allClients[limits.writer];
          overflowClient.send({ type: 'SELECT_ROLE', role: 'writer' });
          const err = await overflowClient.waitFor('ERROR');
          assert.match(err.message, /Слоты на эту роль уже заняты/);
          assert.equal(
            host.lastSnapshot?.players.find((p) => p.id === overflowClient.id)?.role,
            null,
            'Role must remain null after rejection',
          );

          // Reset room for next count iteration
          host.send({ type: 'RETURN_TO_LOBBY' });
          await host.waitForSnapshot((s) => s.screen === 'LOBBY');
        }
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // 2. Segment Count max(3, numWriters) across 0, 1, 2, 3, 4, 5+ writers
  // =========================================================================
  describe('2. Segment Count max(3, numWriters) & Queue Wrapping Oracle', () => {
    it('verifies segment count formula max(3, numWriters) across 0 through 8 writers', () => {
      for (let numWriters = 0; numWriters <= 8; numWriters++) {
        const expectedSegments = Math.max(3, numWriters);
        const writers = Array.from({ length: numWriters }, (_, i) => ({
          id: `w-${i}`,
          name: `Writer ${i}`,
        }));

        const queue: Array<{ id: string; name: string }> = [];
        for (let i = 0; i < expectedSegments; i++) {
          if (writers.length > 0) {
            const w = writers[i % writers.length];
            queue.push({ id: w.id, name: w.name });
          } else {
            queue.push({ id: '', name: 'Авто-редакция' });
          }
        }

        assert.equal(queue.length, expectedSegments);

        if (numWriters === 0) {
          assert.deepEqual(
            queue.map((q) => q.name),
            ['Авто-редакция', 'Авто-редакция', 'Авто-редакция'],
          );
        } else if (numWriters === 1) {
          assert.deepEqual(
            queue.map((q) => q.id),
            ['w-0', 'w-0', 'w-0'],
          );
        } else if (numWriters === 2) {
          assert.deepEqual(
            queue.map((q) => q.id),
            ['w-0', 'w-1', 'w-0'],
          );
        } else {
          for (let i = 0; i < expectedSegments; i++) {
            assert.equal(queue[i].id, `w-${i % numWriters}`);
          }
        }
      }
    });

    it('runs active game with 4 writers (4 segments) verifying sequential execution and transition to REPLAY', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 4,
          artists: 1,
          saboteurs: 1,
          testMode: true,
        });
        t.mock.timers.tick(650);

        const snap0 = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(snap0.segment?.totalSegments, 4);

        // Advance through all 4 segments
        for (let seg = 0; seg < 4; seg++) {
          const prepSnap = await host.waitForSnapshot(
            (s) => s.segment?.index === seg && s.segment?.phase === 'PREP',
          );
          assert.equal(prepSnap.segment?.leadWriterId, writers[seg].id);
          assert.equal(prepSnap.segment?.leadWriterName, writers[seg].name);

          // Lead writer submits headline
          writers[seg].send({ type: 'SUBMIT_HEADLINE', headline: `HEADLINE SEGMENT ${seg}` });
          await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');

          t.mock.timers.tick(TIMINGS.SPLASH_MS);
          await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

          t.mock.timers.tick(TIMINGS.LIVE_MS);
          await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');

          t.mock.timers.tick(TIMINGS.FREEZE_MS);
        }

        // Room must now transition to REPLAY
        const replaySnap = await host.waitForSnapshot((s) => s.screen === 'REPLAY');
        assert.equal(replaySnap.screen, 'REPLAY');
        assert.ok(replaySnap.replay !== null);
        assert.equal(replaySnap.segment, null);
      } finally {
        await harness.cleanup();
      }
    });

    it('runs active game with 0 writers in testMode: automatically progresses PREP with 2.5s timer', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host } = await harness.setupGameWithRoles({
          writers: 0,
          artists: 2,
          saboteurs: 1,
          testMode: true,
        });
        t.mock.timers.tick(650);

        const prepSnap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(prepSnap.segment?.totalSegments, 3);
        assert.equal(prepSnap.segment?.leadWriterName, 'Авто-редакция');
        assert.equal(prepSnap.segment?.leadWriterId, null);

        // Since no human lead writer, PREP duration is 2500ms
        t.mock.timers.tick(2500);
        const splashSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        assert.equal(splashSnap.segment?.phase, 'SPLASH');
        assert.ok(
          FALLBACK_HEADLINES.includes(splashSnap.segment?.headline as any),
          `Auto headline "${splashSnap.segment?.headline}" must be from FALLBACK_HEADLINES`,
        );
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // 3. Reaction Rate Limiter: Burst Spamming vs Precision Interval
  // =========================================================================
  describe('3. Reaction Rate Limiter (<250ms drop vs >=250ms success)', () => {
    it('burst spams 50 reactions spaced by 5ms and verifies EXACTLY 1 is accepted, 49 dropped', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'REACTION BURST TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Saboteur sends 50 reactions 5ms apart
        for (let i = 0; i < 50; i++) {
          saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😂' });
          t.mock.timers.tick(5);
        }
        await flushAsync(10);

        const broadcasts = host.drainMessages().filter((m) => m.type === 'REACTION_BC');
        assert.equal(
          broadcasts.length,
          1,
          `Only the 1st reaction of 50 burst reactions must be broadcast, got ${broadcasts.length}`,
        );
      } finally {
        await harness.cleanup();
      }
    });

    it('verifies exact boundary condition: 249ms is dropped, 250ms is accepted', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'RATE BOUNDARY TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Reaction 1 at t = 0 -> accepted
        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😂' });
        const r1 = await host.waitFor('REACTION_BC');
        assert.equal(r1.emoji, '😂');

        // Attempt at t = 249ms (< 250ms) -> dropped
        t.mock.timers.tick(249);
        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😱' });
        await flushAsync();
        let dropped = host.drainMessages().filter((m) => m.type === 'REACTION_BC');
        assert.equal(dropped.length, 0, 'Reaction at 249ms must be dropped');

        // Attempt at t = 250ms (total +1ms from 249ms = 250ms from r1) -> accepted!
        t.mock.timers.tick(1);
        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '👏' });
        const r2 = await host.waitFor('REACTION_BC');
        assert.equal(r2.emoji, '👏', 'Reaction at exactly 250ms must be accepted');

        // Attempt at +249ms -> dropped
        t.mock.timers.tick(249);
        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '🤦' });
        await flushAsync();
        dropped = host.drainMessages().filter((m) => m.type === 'REACTION_BC');
        assert.equal(dropped.length, 0, 'Reaction at +249ms must be dropped');

        // Attempt at +1ms (total 250ms) -> accepted!
        t.mock.timers.tick(1);
        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '🔥' });
        const r3 = await host.waitFor('REACTION_BC');
        assert.equal(r3.emoji, '🔥');
      } finally {
        await harness.cleanup();
      }
    });

    it('rejects SEND_REACTION from non-saboteur roles (writer and artist)', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ROLE CHECK TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        writers[0].send({ type: 'SEND_REACTION', emoji: '😂' });
        artists[0].send({ type: 'SEND_REACTION', emoji: '😂' });
        await flushAsync();

        const broadcasts = host.drainMessages().filter((m) => m.type === 'REACTION_BC');
        assert.equal(broadcasts.length, 0, 'Non-saboteurs cannot send reactions');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // 4. Unauthorized Actions Matrix during PREP, SPLASH, and FREEZE
  // =========================================================================
  describe('4. Comprehensive Unauthorized Actions Matrix', () => {
    it('exhaustively rejects all interactive actions across PREP, SPLASH, and FREEZE phases', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date', 'setInterval'] });
      try {
        const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
          writers: 2,
          artists: 1,
          saboteurs: 1,
          saboteurClasses: ['vandal'],
          testMode: true,
        });
        t.mock.timers.tick(650);

        const getRoom = () => Array.from((harness.roomManager as any).rooms.values())[0] as any;
        const getSabPlayer = () => getRoom().players.find((p: any) => p.id === saboteurs[0].id);

        const dispatchUnauthorizedPayload = () => {
          // Artist attempts
          artists[0].send({
            type: 'STROKE_START',
            id: 'unauth-s',
            color: '#111827',
            widthNorm: 0.015,
            point: { x: 0.3, y: 0.3 },
          });
          artists[0].send({
            type: 'STROKE_POINTS',
            id: 'unauth-s',
            points: [{ x: 0.31, y: 0.31 }],
          });
          artists[0].send({
            type: 'PLACE_STAMP',
            id: 'unauth-st',
            stampId: 'star',
            color: '#FFFFFF',
            x: 0.4,
            y: 0.4,
          });
          artists[0].send({ type: 'UNDO_LAST' });
          artists[0].send({ type: 'USE_WIPERS' });

          // Writer attempts
          writers[0].send({ type: 'ADD_TICKER', text: 'UNAUTHORIZED TICKER' });
          writers[1].send({ type: 'ADD_TICKER', text: 'UNAUTHORIZED TICKER 2' });

          // Saboteur attempts
          saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.5, y: 0.5 });
          saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'sticker', x: 0.5, y: 0.5 });
          saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😂' });
        };

        // --- Phase 1: PREP ---
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        const initialEnergy = getSabPlayer().energy;

        dispatchUnauthorizedPayload();
        // Non-lead writer attempting SUBMIT_HEADLINE in PREP
        writers[1].send({ type: 'SUBMIT_HEADLINE', headline: 'NON-LEAD ATTEMPT' });
        await flushAsync();

        assert.equal(getRoom().drawItems.length, 0, 'No drawItems allowed in PREP');
        assert.equal(getRoom().sabotageItems.length, 0, 'No sabotageItems allowed in PREP');
        assert.equal(getRoom().ticker.length, 0, 'No ticker allowed in PREP');
        assert.equal(getSabPlayer().energy, initialEnergy, 'Energy must not be deducted in PREP');
        assert.equal(getRoom().segment?.headline, '', 'Headline must not be modified by non-lead');

        // --- Phase 2: SPLASH ---
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'VALID HEADLINE' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');

        dispatchUnauthorizedPayload();
        // Even lead writer cannot submit headline in SPLASH
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'TAMPERED IN SPLASH' });
        await flushAsync();

        assert.equal(getRoom().drawItems.length, 0, 'No drawItems allowed in SPLASH');
        assert.equal(getRoom().sabotageItems.length, 0, 'No sabotageItems allowed in SPLASH');
        assert.equal(getRoom().ticker.length, 0, 'No ticker allowed in SPLASH');
        assert.equal(getSabPlayer().energy, initialEnergy, 'Energy must not be deducted in SPLASH');
        assert.equal(getRoom().segment?.headline, 'VALID HEADLINE', 'Headline locked in SPLASH');

        // Transition to LIVE and perform valid actions
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Valid actions in LIVE
        artists[0].send({
          type: 'STROKE_START',
          id: 'live-stroke',
          color: '#111827',
          widthNorm: 0.015,
          point: { x: 0.5, y: 0.5 },
        });
        await host.waitFor('STROKE_START_BC');
        assert.equal(getRoom().drawItems.length, 1);

        writers[0].send({ type: 'ADD_TICKER', text: 'VALID LIVE TICKER' });
        await host.waitFor('TICKER_ADD_BC');
        assert.equal(getRoom().ticker.length, 1);

        // --- Phase 3: FREEZE ---
        t.mock.timers.tick(TIMINGS.LIVE_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');

        const energyBeforeFreeze = getSabPlayer().energy;
        dispatchUnauthorizedPayload();
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'TAMPERED IN FREEZE' });
        await flushAsync();

        assert.equal(getRoom().drawItems.length, 1, 'No new drawItems allowed in FREEZE');
        assert.equal(getRoom().sabotageItems.length, 0, 'No sabotageItems allowed in FREEZE');
        assert.equal(getRoom().ticker.length, 1, 'No new ticker allowed in FREEZE');
        assert.equal(getSabPlayer().energy, energyBeforeFreeze, 'Energy must not be spent in FREEZE');
        assert.equal(getRoom().segment?.headline, 'VALID HEADLINE', 'Headline locked in FREEZE');
      } finally {
        await harness.cleanup();
      }
    });

    it('rejects cross-class and out-of-role action spoofing during LIVE', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
          saboteurClasses: ['vandal'],
        });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'CROSS CLASS SPOOF TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const getRoom = () => Array.from((harness.roomManager as any).rooms.values())[0] as any;
        const getSabPlayer = () => getRoom().players.find((p: any) => p.id === saboteurs[0].id);

        const initialEnergy = getSabPlayer().energy;

        // 1. Vandal saboteur attempts Hacker ability (glitch, flip) or Director ability (forced_brush, censor)
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'glitch' });
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'forced_brush' });
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'censor' });
        await flushAsync();

        assert.equal(getSabPlayer().energy, initialEnergy, 'Cross-class ability must not deduct energy');
        assert.equal(getRoom().effects.glitchUntil, 0, 'Glitch effect must not be triggered');
        assert.equal(getRoom().effects.forcedBrushUntil, 0, 'Forced brush effect must not be triggered');
        assert.equal(getRoom().sabotageItems.length, 0, 'Censor item must not be created');

        // 2. Writer attempts to draw strokes or use wipers
        writers[0].send({
          type: 'STROKE_START',
          id: 'writer-stroke',
          color: '#FFFFFF',
          widthNorm: 0.015,
          point: { x: 0.1, y: 0.1 },
        });
        writers[0].send({ type: 'USE_WIPERS' });
        await flushAsync();
        assert.equal(getRoom().drawItems.length, 0, 'Writer cannot draw or use wipers');

        // 3. Artist attempts to add ticker
        artists[0].send({ type: 'ADD_TICKER', text: 'ARTIST FAKE TICKER' });
        await flushAsync();
        assert.equal(getRoom().ticker.length, 0, 'Artist cannot add ticker');

        // 4. Writer attempts to submit headline during LIVE
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'MUTATE IN LIVE' });
        await flushAsync();
        assert.equal(getRoom().segment?.headline, 'CROSS CLASS SPOOF TEST', 'Headline immutable in LIVE');
      } finally {
        await harness.cleanup();
      }
    });
  });
});
