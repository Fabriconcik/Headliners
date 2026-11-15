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
} from '../shared/constants.js';
import {
  canTakeRole,
  countTakenRoles,
  finalizePlayerRoles,
  randomSaboteurClass,
} from '../server/roleAllocator.js';
import type { PlayerInfo } from '../shared/protocol.js';

/**
 * Microtask flusher for MockWebSocket message propagation.
 */
async function flushAsync(count = 5): Promise<void> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

describe('Milestone 2: State Machine & Server Logic', () => {
  // =========================================================================
  // 1. Segment Count Calculation & Queue Rotation
  // Formula: max(3, numWriters)
  // =========================================================================
  describe('1. Segment Count Calculation (max(3, numWriters))', () => {
    it('calculates total segments as 3 for 0 writers (auto-editor fallback)', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host } = await harness.setupGameWithRoles({
          writers: 0,
          artists: 1,
          saboteurs: 1,
          testMode: true,
        });
        t.mock.timers.tick(650);
        const snap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(snap.segment?.totalSegments, 3);
        assert.equal(snap.segment?.index, 0);
        assert.equal(snap.segment?.leadWriterName, 'Авто-редакция');
        assert.equal(snap.segment?.leadWriterId, null);
      } finally {
        await harness.cleanup();
      }
    });

    it('calculates total segments as 3 for 1 writer', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 2,
          saboteurs: 1,
        });
        t.mock.timers.tick(650);
        const snap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(snap.segment?.totalSegments, 3);
        assert.equal(snap.segment?.leadWriterId, writers[0].id);
      } finally {
        await harness.cleanup();
      }
    });

    it('calculates total segments as 3 for 2 writers', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 2,
          artists: 2,
          saboteurs: 1,
          testMode: true,
        });
        t.mock.timers.tick(650);
        const snap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(snap.segment?.totalSegments, 3);
      } finally {
        await harness.cleanup();
      }
    });

    it('calculates total segments as 3 for 3 writers', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 3,
          artists: 1,
          saboteurs: 1,
          testMode: true,
        });
        t.mock.timers.tick(650);
        const snap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(snap.segment?.totalSegments, 3);
      } finally {
        await harness.cleanup();
      }
    });

    it('calculates total segments as 4 for 4 writers', async (t) => {
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
        const snap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(snap.segment?.totalSegments, 4);
      } finally {
        await harness.cleanup();
      }
    });

    it('calculates total segments as 5 for 5 writers', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 5,
          artists: 1,
          saboteurs: 1,
          testMode: true,
        });
        t.mock.timers.tick(650);
        const snap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(snap.segment?.totalSegments, 5);
      } finally {
        await harness.cleanup();
      }
    });

    it('rotates lead writers round-robin across segments (w0 -> w1 -> w0)', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 2,
          artists: 2,
          saboteurs: 1,
          testMode: true,
        });
        t.mock.timers.tick(650);

        // Segment 0: Lead is writers[0]
        const s0 = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(s0.segment?.index, 0);
        assert.equal(s0.segment?.leadWriterId, writers[0].id);

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'HEADLINE SEG 0' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
        t.mock.timers.tick(TIMINGS.LIVE_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
        t.mock.timers.tick(TIMINGS.FREEZE_MS);

        // Segment 1: Lead is writers[1]
        const s1 = await host.waitForSnapshot((s) => s.segment?.index === 1);
        assert.equal(s1.segment?.leadWriterId, writers[1].id);

        writers[1].send({ type: 'SUBMIT_HEADLINE', headline: 'HEADLINE SEG 1' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
        t.mock.timers.tick(TIMINGS.LIVE_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
        t.mock.timers.tick(TIMINGS.FREEZE_MS);

        // Segment 2: Lead wraps back to writers[0]
        const s2 = await host.waitForSnapshot((s) => s.segment?.index === 2);
        assert.equal(s2.segment?.leadWriterId, writers[0].id);
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // 2. Role Allocation Slot Caps & Fallback Assignment
  // =========================================================================
  describe('2. Role Allocation Slot Caps & Fallback Assignment', () => {
    it('computes correct slot limits for player counts 4 through 10', () => {
      const expected: Record<number, { writer: number; artist: number; saboteur: number }> = {
        4: { writer: 1, artist: 2, saboteur: 1 },
        5: { writer: 1, artist: 3, saboteur: 1 },
        6: { writer: 2, artist: 3, saboteur: 1 },
        7: { writer: 2, artist: 3, saboteur: 2 },
        8: { writer: 2, artist: 4, saboteur: 2 },
        9: { writer: 2, artist: 4, saboteur: 3 },
        10: { writer: 3, artist: 4, saboteur: 3 },
      };

      for (let n = 4; n <= 10; n++) {
        const slots = computeRoleSlots(n, false);
        assert.deepEqual(slots, expected[n], `Mismatch in slot calculation for ${n} players`);
        assert.equal(
          slots.writer + slots.artist + slots.saboteur,
          n,
          `Sum of slots for ${n} players must equal ${n}`,
        );
      }
    });

    it('computes testMode slot limits allowing lone or 2-3 testers to select roles', () => {
      for (const n of [1, 2, 3]) {
        const slots = computeRoleSlots(n, true);
        assert.deepEqual(slots, { writer: 1, artist: 2, saboteur: 1 });
      }
    });

    it('strictly enforces slot limits in non-testMode rejecting overflow role selection', async () => {
      const harness = new TestHarness();
      try {
        const { host, players } = await harness.setupLobby({ playerCount: 4, testMode: false });
        host.send({ type: 'START_GAME' });
        await host.waitForSnapshot((s) => s.screen === 'ROLE_SELECT');

        // Slot limit for 4 players: writer: 1, artist: 2, saboteur: 1
        host.send({ type: 'SELECT_ROLE', role: 'writer' });
        await host.waitForSnapshot(
          (s) => s.players.find((p) => p.id === host.id)?.role === 'writer',
        );

        // Second player tries to select writer
        players[0].send({ type: 'SELECT_ROLE', role: 'writer' });
        const err = await players[0].waitFor('ERROR');
        assert.match(err.message, /Слоты на эту роль уже заняты/);
      } finally {
        await harness.cleanup();
      }
    });

    it('strictly assigns unassigned players in order: writer -> artist -> saboteur', () => {
      const makePlayers = (count: number): PlayerInfo[] =>
        Array.from({ length: count }, (_, i) => ({
          id: `p${i}`,
          name: `Player ${i}`,
          isHost: i === 0,
          isBot: false,
          connected: true,
          role: null,
          saboteurClass: null,
          energy: ENERGY.START,
          wipersCooldownUntil: 0,
        }));

      // Test with 6 players (limits: writer: 2, artist: 3, saboteur: 1)
      const players6 = makePlayers(6);
      const limits6 = finalizePlayerRoles(players6, false);
      assert.deepEqual(limits6, { writer: 2, artist: 3, saboteur: 1 });

      // First 2 players must be writer
      assert.equal(players6[0].role, 'writer');
      assert.equal(players6[0].saboteurClass, null);
      assert.equal(players6[1].role, 'writer');
      assert.equal(players6[1].saboteurClass, null);

      // Next 3 players must be artist
      assert.equal(players6[2].role, 'artist');
      assert.equal(players6[2].saboteurClass, null);
      assert.equal(players6[3].role, 'artist');
      assert.equal(players6[3].saboteurClass, null);
      assert.equal(players6[4].role, 'artist');
      assert.equal(players6[4].saboteurClass, null);

      // Last player must be saboteur with a valid saboteurClass
      assert.equal(players6[5].role, 'saboteur');
      assert.ok(
        ['vandal', 'hacker', 'director'].includes(players6[5].saboteurClass as any),
        `Saboteur class must be vandal, hacker, or director, got ${players6[5].saboteurClass}`,
      );
    });

    it('assigns random saboteur class from [vandal, hacker, director] for fallback saboteurs', () => {
      const validClasses = new Set(['vandal', 'hacker', 'director']);
      const generated = new Set<string>();

      for (let i = 0; i < 50; i++) {
        const cls = randomSaboteurClass();
        assert.ok(validClasses.has(cls));
        generated.add(cls);
      }
      assert.equal(generated.size, 3, 'Must be able to generate all 3 saboteur classes over runs');
    });

    it('sets saboteurClass to null for non-saboteurs in finalizePlayerRoles', () => {
      const players: PlayerInfo[] = [
        {
          id: 'p1',
          name: 'P1',
          isHost: true,
          isBot: false,
          connected: true,
          role: 'artist',
          saboteurClass: 'vandal', // Erroneously set saboteur class on artist
          energy: 60,
          wipersCooldownUntil: 0,
        },
      ];
      finalizePlayerRoles(players, true);
      assert.equal(players[0].saboteurClass, null, 'Non-saboteur must have saboteurClass reset to null');
    });
  });

  // =========================================================================
  // 3. PREP Phase: Early SUBMIT_HEADLINE
  // =========================================================================
  describe('3. PREP Phase: Early SUBMIT_HEADLINE', () => {
    it('lead writer submitting headline immediately transitions phase to SPLASH', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'BREAKING: ALIEN INVASION CONFIRMED' });
        const splashSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        assert.equal(splashSnap.segment?.phase, 'SPLASH');
        assert.equal(splashSnap.segment?.headline, 'BREAKING: ALIEN INVASION CONFIRMED');
      } finally {
        await harness.cleanup();
      }
    });

    it('trims whitespace and converts submitted headline to uppercase', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: '   cats take over city hall   ' });
        const splashSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        assert.equal(splashSnap.segment?.headline, 'CATS TAKE OVER CITY HALL');
      } finally {
        await harness.cleanup();
      }
    });

    it('empty or whitespace headline submission falls back to a random headline from FALLBACK_HEADLINES', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: '     ' });
        const splashSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        assert.equal(splashSnap.segment?.phase, 'SPLASH');
        assert.ok(
          FALLBACK_HEADLINES.includes(splashSnap.segment?.headline as any),
          `Fallback headline "${splashSnap.segment?.headline}" must be in FALLBACK_HEADLINES`,
        );
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // 4. PREP Phase: 30s Timeout Fallback Headline
  // =========================================================================
  describe('4. PREP Phase: 30s Timeout Fallback', () => {
    it('transitions to SPLASH with random fallback headline when 30s timer expires', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        // Advance the full 30,000ms PREP duration
        t.mock.timers.tick(TIMINGS.PREP_MAX_MS);

        const splashSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        assert.equal(splashSnap.segment?.phase, 'SPLASH');
        assert.ok(
          FALLBACK_HEADLINES.includes(splashSnap.segment?.headline as any),
          `Headline "${splashSnap.segment?.headline}" must be from FALLBACK_HEADLINES`,
        );
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // 5. Rejection of SUBMIT_HEADLINE from Non-Lead Writers and Non-Writers
  // =========================================================================
  describe('5. Rejection of Unauthorized SUBMIT_HEADLINE', () => {
    it('ignores SUBMIT_HEADLINE sent by non-lead writer', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 2,
          artists: 2,
          saboteurs: 1,
          testMode: true,
        });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        // writers[0] is lead writer; writers[1] is non-lead writer
        writers[1].send({ type: 'SUBMIT_HEADLINE', headline: 'UNAUTHORIZED HEADLINE' });

        await flushAsync();
        assert.equal(host.lastSnapshot?.segment?.phase, 'PREP', 'Phase must remain PREP');
        assert.equal(host.lastSnapshot?.segment?.headline, '', 'Headline must not be set');
      } finally {
        await harness.cleanup();
      }
    });

    it('ignores SUBMIT_HEADLINE sent by artist or saboteur', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, artists, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        artists[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ARTIST HEADLINE' });
        saboteurs[0].send({ type: 'SUBMIT_HEADLINE', headline: 'SABOTEUR HEADLINE' });

        await flushAsync();
        assert.equal(host.lastSnapshot?.segment?.phase, 'PREP');
        assert.equal(host.lastSnapshot?.segment?.headline, '');
      } finally {
        await harness.cleanup();
      }
    });

    it('ignores SUBMIT_HEADLINE sent outside of PREP phase (during LIVE or FREEZE)', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'CORRECT HEADLINE' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Attempt mutation in LIVE
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'MUTATION IN LIVE' });
        await flushAsync();
        assert.equal(host.lastSnapshot?.segment?.headline, 'CORRECT HEADLINE');

        t.mock.timers.tick(TIMINGS.LIVE_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');

        // Attempt mutation in FREEZE
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'MUTATION IN FREEZE' });
        await flushAsync();
        assert.equal(host.lastSnapshot?.segment?.headline, 'CORRECT HEADLINE');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // 6. Full Phase Transitions: PREP -> SPLASH -> LIVE -> FREEZE -> REPLAY
  // =========================================================================
  describe('6. Full Phase Transitions & Recording', () => {
    it('executes full round sequence: PREP -> SPLASH -> LIVE -> FREEZE', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'FULL CYCLE TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');

        // Advance SPLASH (3s)
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        const liveSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
        assert.equal(liveSnap.segment?.phase, 'LIVE');

        // Advance LIVE (45s)
        t.mock.timers.tick(TIMINGS.LIVE_MS);
        const freezeSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
        assert.equal(freezeSnap.segment?.phase, 'FREEZE');

        // Advance FREEZE (3s) -> moves to segment 1 PREP
        t.mock.timers.tick(TIMINGS.FREEZE_MS);
        const nextPrep = await host.waitForSnapshot(
          (s) => s.segment?.index === 1 && s.segment?.phase === 'PREP',
        );
        assert.equal(nextPrep.segment?.index, 1);
        assert.equal(nextPrep.segment?.phase, 'PREP');
      } finally {
        await harness.cleanup();
      }
    });

    it('records segment events excluding PREP and transitions final segment to REPLAY', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 2,
          saboteurs: 1,
        });
        t.mock.timers.tick(650);

        // Run through all 3 segments
        for (let seg = 0; seg < 3; seg++) {
          await host.waitForSnapshot((s) => s.segment?.index === seg && s.segment?.phase === 'PREP');
          writers[0].send({ type: 'SUBMIT_HEADLINE', headline: `SEGMENT ${seg}` });
          await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
          t.mock.timers.tick(TIMINGS.SPLASH_MS);
          await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
          t.mock.timers.tick(TIMINGS.LIVE_MS);
          await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
          t.mock.timers.tick(TIMINGS.FREEZE_MS);
        }

        // Room transitions to REPLAY
        const replaySnap = await host.waitForSnapshot((s) => s.screen === 'REPLAY');
        assert.equal(replaySnap.screen, 'REPLAY');
        assert.equal(replaySnap.segment, null);
        assert.ok(replaySnap.replay !== null, 'Replay payload must be compiled');
        assert.equal(replaySnap.drawItems.length, 0);
        assert.equal(replaySnap.sabotageItems.length, 0);
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // 7. Action Locking During PREP, SPLASH, and FREEZE
  // =========================================================================
  describe('7. Action Locking During PREP, SPLASH, and FREEZE', () => {
    it('strictly locks canvas drawing, stamps, wipers, ticker, abilities, and reactions in non-LIVE phases', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);

        const getRoom = () => Array.from((harness.roomManager as any).rooms.values())[0] as any;

        // Helper to attempt all interactive actions
        const sendActions = () => {
          artists[0].send({
            type: 'STROKE_START',
            id: 's-locked',
            color: '#000000',
            widthNorm: 0.01,
            point: { x: 0.5, y: 0.5 },
          });
          artists[0].send({
            type: 'PLACE_STAMP',
            id: 'st-locked',
            stampId: 'star',
            color: '#FF0000',
            x: 0.5,
            y: 0.5,
          });
          artists[0].send({ type: 'USE_WIPERS' });
          writers[0].send({ type: 'ADD_TICKER', text: 'LOCKED TICKER' });
          saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato' });
          saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😂' });
        };

        // --- 1. Test in PREP ---
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        sendActions();
        await flushAsync();
        assert.equal(getRoom().drawItems.length, 0, 'No draw items in PREP');
        assert.equal(getRoom().sabotageItems.length, 0, 'No sabotage items in PREP');
        assert.equal(getRoom().ticker.length, 0, 'No ticker in PREP');

        // --- 2. Test in SPLASH ---
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'TEST ACTIONS' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        sendActions();
        await flushAsync();
        assert.equal(getRoom().drawItems.length, 0, 'No draw items in SPLASH');
        assert.equal(getRoom().sabotageItems.length, 0, 'No sabotage items in SPLASH');
        assert.equal(getRoom().ticker.length, 0, 'No ticker in SPLASH');

        // Advance to LIVE and draw an item
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
        artists[0].send({
          type: 'STROKE_START',
          id: 'live-stroke',
          color: '#111111',
          widthNorm: 0.02,
          point: { x: 0.1, y: 0.1 },
        });
        await host.waitFor('STROKE_START_BC');
        assert.equal(getRoom().drawItems.length, 1);

        // --- 3. Test in FREEZE ---
        t.mock.timers.tick(TIMINGS.LIVE_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
        sendActions();
        await flushAsync();
        assert.equal(getRoom().drawItems.length, 1, 'Draw items count must not increase in FREEZE');
        assert.equal(getRoom().sabotageItems.length, 0, 'No sabotage items in FREEZE');
        assert.equal(getRoom().ticker.length, 0, 'No ticker in FREEZE');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // 8. Wipers 7,000ms Cooldown Enforcement and Layer Isolation
  // =========================================================================
  describe('8. Wipers 7,000ms Cooldown & Layer Isolation', () => {
    it('clears sabotageItems layer while completely preserving drawItems layer', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'WIPERS TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const getRoom = () => Array.from((harness.roomManager as any).rooms.values())[0] as any;

        // Artist draws stroke
        artists[0].send({
          type: 'STROKE_START',
          id: 'artist-s1',
          color: '#00FF00',
          widthNorm: 0.02,
          point: { x: 0.2, y: 0.2 },
        });
        await host.waitFor('STROKE_START_BC');

        // Saboteur throws tomato
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.5, y: 0.5 });
        await host.waitFor('SABOTAGE_VISUAL_BC');

        assert.equal(getRoom().drawItems.length, 1);
        assert.equal(getRoom().sabotageItems.length, 1);

        // Artist uses wipers
        artists[0].send({ type: 'USE_WIPERS' });
        const wipersBc = await host.waitFor('WIPERS_BC');
        assert.equal(wipersBc.actorId, artists[0].id);

        // Sabotage items cleared; draw items preserved
        assert.equal(getRoom().sabotageItems.length, 0, 'Sabotage layer must be completely cleared');
        assert.equal(getRoom().drawItems.length, 1, 'Artist draw items must be preserved untouched');
        assert.equal(getRoom().drawItems[0].id, 'artist-s1');
      } finally {
        await harness.cleanup();
      }
    });

    it('enforces 7,000ms wipers cooldown on the same artist and rejects premature reuse', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'WIPERS COOLDOWN' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const getRoom = () => Array.from((harness.roomManager as any).rooms.values())[0] as any;

        // Artist uses wipers
        artists[0].send({ type: 'USE_WIPERS' });
        const wipersMsg = await host.waitFor('WIPERS_BC');
        assert.equal(wipersMsg.actorId, artists[0].id);

        // Add sabotage item
        t.mock.timers.tick(2000);
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.4, y: 0.4 });
        await host.waitFor('SABOTAGE_VISUAL_BC');
        assert.equal(getRoom().sabotageItems.length, 1);

        // Same artist calls wipers prematurely (at t = 2000ms < 7000ms)
        artists[0].send({ type: 'USE_WIPERS' });
        await flushAsync();
        assert.equal(getRoom().sabotageItems.length, 1, 'Premature wipers call must be rejected');

        // Advance to t = 7001ms (> 7000ms)
        t.mock.timers.tick(5001);
        artists[0].send({ type: 'USE_WIPERS' });
        await host.waitFor('WIPERS_BC');
        assert.equal(getRoom().sabotageItems.length, 0, 'Wipers must succeed after 7000ms cooldown');
      } finally {
        await harness.cleanup();
      }
    });

    it('tracks wipers cooldown per-artist without blocking other artists', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'MULTI ARTIST WIPERS' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const getRoom = () => Array.from((harness.roomManager as any).rooms.values())[0] as any;

        // Artist 0 uses wipers
        artists[0].send({ type: 'USE_WIPERS' });
        const w0 = await host.waitFor('WIPERS_BC');
        assert.equal(w0.actorId, artists[0].id);

        // Saboteur adds tomato
        t.mock.timers.tick(1000);
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato' });
        await host.waitFor('SABOTAGE_VISUAL_BC');
        assert.equal(getRoom().sabotageItems.length, 1);

        // Artist 1 uses wipers (has independent cooldown)
        artists[1].send({ type: 'USE_WIPERS' });
        const w1 = await host.waitFor('WIPERS_BC');
        assert.equal(w1.actorId, artists[1].id, 'Artist 1 wipers must succeed despite Artist 0 cooldown');
        assert.equal(getRoom().sabotageItems.length, 0);
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // 9. Forced Brush 4,000ms Lockout
  // =========================================================================
  describe('9. Forced Brush 4,000ms Lockout', () => {
    it('overrides artist stroke color to #FF10F0 and widthNorm to 0.075 during 4s lockout', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
          saboteurClasses: ['director'],
        });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'FORCED BRUSH TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Director saboteur casts forced_brush
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'forced_brush' });
        const fxMsg = await host.waitFor('SABOTAGE_FX_BC');
        assert.equal(fxMsg.fx, 'forced_brush');

        // Artist draws stroke with custom color and small width
        artists[0].send({
          type: 'STROKE_START',
          id: 'forced-stroke-1',
          color: '#00FF00',
          widthNorm: 0.005,
          point: { x: 0.1, y: 0.1 },
        });

        const strokeStart1 = await host.waitFor('STROKE_START_BC', (m) => m.item.id === 'forced-stroke-1');
        assert.equal(strokeStart1.item.color, FORCED_BRUSH.color, `Color must be forced to ${FORCED_BRUSH.color}`);
        assert.equal(strokeStart1.item.widthNorm, FORCED_BRUSH.widthNorm, `Width must be forced to ${FORCED_BRUSH.widthNorm}`);

        // Advance past 4,000ms lockout
        t.mock.timers.tick(TIMINGS.FORCED_BRUSH_DURATION_MS + 1);

        // Artist draws stroke again after lockout expires
        artists[0].send({
          type: 'STROKE_START',
          id: 'normal-stroke-2',
          color: '#00FF00',
          widthNorm: 0.005,
          point: { x: 0.2, y: 0.2 },
        });

        const strokeStart2 = await host.waitFor('STROKE_START_BC', (m) => m.item.id === 'normal-stroke-2');
        assert.equal(strokeStart2.item.color, '#00FF00', 'Original color must be restored after lockout expires');
        assert.equal(strokeStart2.item.widthNorm, 0.005, 'Original width must be restored after lockout expires');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // 10. Saboteur Energy Accumulation & Ability Costs
  // =========================================================================
  describe('10. Saboteur Energy Accumulation & Ability Costs', () => {
    it('regenerates energy at +10/sec (+2 every 200ms) up to max 100 during LIVE', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date', 'setInterval'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ENERGY TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const getRoom = () => Array.from((harness.roomManager as any).rooms.values())[0] as any;
        const getSabPlayer = () => getRoom().players.find((p: any) => p.id === saboteurs[0].id);

        assert.equal(getSabPlayer().energy, ENERGY.START, `Initial energy must be ${ENERGY.START}`);

        // Advance 2,000ms -> +20 energy (10 intervals of 200ms * +2)
        t.mock.timers.tick(2000);
        await flushAsync();
        assert.equal(Math.round(getSabPlayer().energy), 80, 'Energy must increase by +20 after 2 seconds');

        // Advance 3,000ms more -> should hit max 100
        t.mock.timers.tick(3000);
        await flushAsync();
        assert.equal(Math.round(getSabPlayer().energy), ENERGY.MAX, `Energy must cap at ${ENERGY.MAX}`);

        // Advance further -> must remain capped at 100
        t.mock.timers.tick(5000);
        await flushAsync();
        assert.equal(Math.round(getSabPlayer().energy), ENERGY.MAX, 'Energy must not exceed 100');
      } finally {
        await harness.cleanup();
      }
    });

    it('deducts exact ability cost on execution and rejects when energy is insufficient', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date', 'setInterval'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
          saboteurClasses: ['vandal'],
        });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ABILITY COST TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const getRoom = () => Array.from((harness.roomManager as any).rooms.values())[0] as any;

        // Start at 60 energy. Tomato cost is 25.
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato' });
        const update1 = await saboteurs[0].waitFor('ENERGY_UPDATE');
        assert.equal(update1.energy, 60 - ABILITIES.tomato.cost); // 35
        await host.waitFor('SABOTAGE_VISUAL_BC');
        assert.equal(getRoom().sabotageItems.length, 1);

        // Cast tomato again (cost 25). 35 - 25 = 10.
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato' });
        const update2 = await saboteurs[0].waitFor('ENERGY_UPDATE');
        assert.equal(update2.energy, 10);
        await host.waitFor('SABOTAGE_VISUAL_BC');
        assert.equal(getRoom().sabotageItems.length, 2);

        // Try casting tomato a 3rd time with only 10 energy (< 25 cost).
        // Must be rejected; sabotageItems count remains 2
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato' });
        await flushAsync();
        assert.equal(getRoom().sabotageItems.length, 2, 'Third tomato must be rejected');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // 11. Reaction Rate Limiter (250ms interval)
  // =========================================================================
  describe('11. Reaction Rate Limiter (250ms interval)', () => {
    it('drops reactions sent less than 250ms apart', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'REACTION RATE LIMIT' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // First reaction accepted
        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😂' });
        const r1 = await host.waitFor('REACTION_BC');
        assert.equal(r1.emoji, '😂');

        // Immediate reaction after 100ms (< 250ms) -> must be dropped
        t.mock.timers.tick(100);
        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😱' });
        await flushAsync();
        const broadcasts = host.drainMessages().filter((m) => m.type === 'REACTION_BC');
        assert.equal(broadcasts.length, 0, 'Reaction sent < 250ms must be dropped');

        // Reaction after 250ms -> must be accepted
        t.mock.timers.tick(250);
        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '👏' });
        const r2 = await host.waitFor('REACTION_BC');
        assert.equal(r2.emoji, '👏');
      } finally {
        await harness.cleanup();
      }
    });

    it('permits simultaneous reactions from two distinct saboteurs without crosstalk', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 2,
          testMode: true,
        });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'DUAL SABOTEUR REACTION' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Both send at the exact same timestamp
        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😂' });
        saboteurs[1].send({ type: 'SEND_REACTION', emoji: '🔥' });

        const r0 = await host.waitFor('REACTION_BC', (m) => m.senderId === saboteurs[0].id);
        const r1 = await host.waitFor('REACTION_BC', (m) => m.senderId === saboteurs[1].id);
        assert.equal(r0.emoji, '😂');
        assert.equal(r1.emoji, '🔥');
      } finally {
        await harness.cleanup();
      }
    });
  });
});
