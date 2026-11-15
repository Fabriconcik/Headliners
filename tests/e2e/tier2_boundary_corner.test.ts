import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { TestHarness } from './harness.js';
import { extractSingleEmoji } from '../../shared/emoji.js';
import { buildReplayPayload } from '../../server/replayAnalyzer.js';
import {
  ENERGY,
  FALLBACK_HEADLINES,
  TIMINGS,
} from '../../shared/constants.js';

/**
 * Flushes microtask queue so MockWebSocket messages process
 * without relying on global setTimeout (which is intercepted by mock.timers).
 */
async function flushAsync(count = 5): Promise<void> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

describe('Tier 2: Boundary & Corner Cases E2E Test Suite', () => {
  // =========================================================================
  // Feature 1: Single-Emoji Validator Boundary Cases
  // Source: ORIGINAL_REQUEST.md §R3.3, PROJECT.md Interface Contract 1
  // =========================================================================
  describe('Feature 1: Single-Emoji Validator Boundary Cases', () => {
    test('1.1 rejects plain text strings', () => {
      assert.equal(extractSingleEmoji('hello'), null);
      assert.equal(extractSingleEmoji('новости'), null);
      assert.equal(extractSingleEmoji('breaking news'), null);
    });

    test('1.2 rejects multiple emojis', () => {
      assert.equal(extractSingleEmoji('😂😂'), null);
      assert.equal(extractSingleEmoji('👍🎉'), null);
      assert.equal(extractSingleEmoji('🔥🔥🔥'), null);
    });

    test('1.3 rejects mixed text and emoji strings', () => {
      assert.equal(extractSingleEmoji('hello 😂'), null);
      assert.equal(extractSingleEmoji('🎉 bravo'), null);
      assert.equal(extractSingleEmoji('urgent: 🚨'), null);
      assert.equal(extractSingleEmoji('😂 wow'), null);
    });

    test('1.4 rejects empty string and whitespace', () => {
      assert.equal(extractSingleEmoji(''), null);
      assert.equal(extractSingleEmoji('   '), null);
      assert.equal(extractSingleEmoji('\t\n\r'), null);
      assert.equal(extractSingleEmoji(' \u00A0 '), null);
    });

    test('1.5 rejects digits and punctuation without emoji keycap', () => {
      assert.equal(extractSingleEmoji('1'), null);
      assert.equal(extractSingleEmoji('!'), null);
      assert.equal(extractSingleEmoji('# '), null);
      assert.equal(extractSingleEmoji('*'), null);
      assert.equal(extractSingleEmoji('123'), null);
    });
  });

  // =========================================================================
  // Feature 2: Emoji Antispam Rate Limit
  // Source: ORIGINAL_REQUEST.md §R3.1, §R3.2, §R3.3, PROJECT.md Feature 2
  // =========================================================================
  describe('Feature 2: Emoji Antispam Rate Limit', () => {
    test('2.1 rapid reaction sent within 100ms (<250ms) is dropped by rate limiter', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'RATE LIMIT RAPID' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // First reaction at t=0
        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😂' });
        const r1 = await host.waitFor('REACTION_BC');
        assert.equal(r1.emoji, '😂');

        // Second reaction at t=100ms (<250ms cooldown)
        t.mock.timers.tick(100);
        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😱' });

        await flushAsync();
        const history = host.drainMessages();
        const leaked = history.some((m) => m.type === 'REACTION_BC' && (m as any).emoji === '😱');
        assert.equal(leaked, false, 'Rapid reaction within 100ms must be dropped by server');
      } finally {
        await harness.cleanup();
      }
    });

    test('2.2 burst of 10 reactions within 500ms allows at most rate-limited count', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'BURST TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        for (let i = 0; i < 10; i++) {
          saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😂' });
          await flushAsync(2);
          t.mock.timers.tick(50);
        }

        await flushAsync();
        const allBroadcasts = host.drainMessages().filter((m) => m.type === 'REACTION_BC');
        assert.ok(
          allBroadcasts.length <= 3,
          `Burst of 10 reactions in 500ms must allow at most 3, got ${allBroadcasts.length}`,
        );
      } finally {
        await harness.cleanup();
      }
    });

    test('2.3 reaction exactly at cooldown boundary (250ms) is accepted', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'EXACT 250MS' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😂' });
        const r1 = await host.waitFor('REACTION_BC');
        assert.equal(r1.emoji, '😂');

        t.mock.timers.tick(250);
        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '👏' });
        const r2 = await host.waitFor('REACTION_BC');
        assert.equal(r2.emoji, '👏', 'Reaction sent at exactly 250ms boundary must be accepted');
      } finally {
        await harness.cleanup();
      }
    });

    test('2.4 two different saboteurs sending simultaneously are both accepted', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        // 7 players provides { writer: 2, artist: 3, saboteur: 2 } matching role slots
        const { host, writers, saboteurs } = await harness.setupGameWithRoles({
          writers: 2,
          artists: 3,
          saboteurs: 2,
        });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'DUAL SABOTEUR' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😂' });
        saboteurs[1].send({ type: 'SEND_REACTION', emoji: '😱' });

        const r0 = await host.waitFor('REACTION_BC', (m) => m.senderId === saboteurs[0].id);
        const r1 = await host.waitFor('REACTION_BC', (m) => m.senderId === saboteurs[1].id);
        assert.equal(r0.emoji, '😂');
        assert.equal(r1.emoji, '😱');
      } finally {
        await harness.cleanup();
      }
    });

    test('2.5 reaction sent by writer or artist is rejected', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ROLE REACTION TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        writers[0].send({ type: 'SEND_REACTION', emoji: '😂' });
        artists[0].send({ type: 'SEND_REACTION', emoji: '😱' });

        await flushAsync();
        const broadcasts = host.drainMessages().filter((m) => m.type === 'REACTION_BC');
        assert.equal(broadcasts.length, 0, 'Reactions from non-saboteurs must be strictly rejected');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // Feature 3: Saboteur Energy & Abilities
  // Source: ORIGINAL_REQUEST.md §R1.3, R3.1, R4.1, PROJECT.md Feature 4, 15
  // =========================================================================
  describe('Feature 3: Saboteur Energy & Abilities', () => {
    test('3.1 ability cost > current energy is rejected and energy remains unchanged', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles({
          saboteurClasses: ['hacker'],
        });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'COST CHECK' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Hacker starts with 60 energy. Flip cost is 65.
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'flip' });

        await flushAsync();
        const fxBc = host.drainMessages().filter((m) => m.type === 'SABOTAGE_FX_BC');
        assert.equal(fxBc.length, 0, 'Flip FX must not broadcast when energy is insufficient');

        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        const sab = room.players.find((p: any) => p.id === saboteurs[0].id);
        assert.equal(sab.energy, 60, 'Energy must remain unchanged');
      } finally {
        await harness.cleanup();
      }
    });

    test('3.2 ability cost == current energy is accepted and energy drops to exactly 0', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles({
          saboteurClasses: ['vandal'],
        });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'EXACT ENERGY' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Set saboteur energy to exactly 25 (tomato cost = 25)
        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        const sab = room.players.find((p: any) => p.id === saboteurs[0].id);
        sab.energy = 25;

        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.5, y: 0.5 });
        const energyUpdate = await saboteurs[0].waitFor('ENERGY_UPDATE');
        assert.equal(energyUpdate.energy, 0, 'Energy update must report 0');
        assert.equal(sab.energy, 0, 'Server player energy must reach 0');

        const visual = await host.waitFor('SABOTAGE_VISUAL_BC');
        assert.equal(visual.item.type, 'tomato');
      } finally {
        await harness.cleanup();
      }
    });

    test('3.3 ability activation during PREP, SPLASH, or FREEZE is rejected', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles({
          saboteurClasses: ['vandal'],
        });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        // Attempt in PREP
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato' });
        await flushAsync();
        assert.equal(
          host.drainMessages().filter((m) => m.type === 'SABOTAGE_VISUAL_BC').length,
          0,
          'Ability in PREP must be rejected',
        );

        // Transition to SPLASH
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'PHASE LOCK' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');

        // Attempt in SPLASH
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato' });
        await flushAsync();
        assert.equal(
          host.drainMessages().filter((m) => m.type === 'SABOTAGE_VISUAL_BC').length,
          0,
          'Ability in SPLASH must be rejected',
        );

        // Transition to LIVE, then FREEZE
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
        t.mock.timers.tick(45000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');

        // Attempt in FREEZE
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato' });
        await flushAsync();
        assert.equal(
          host.drainMessages().filter((m) => m.type === 'SABOTAGE_VISUAL_BC').length,
          0,
          'Ability in FREEZE must be rejected',
        );
      } finally {
        await harness.cleanup();
      }
    });

    test('3.4 cross-class ability execution is rejected', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles({
          saboteurClasses: ['vandal'],
        });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'CROSS CLASS' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Vandal attempts Hacker's glitch
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'glitch' });
        await flushAsync();
        const fx = host.drainMessages().filter((m) => m.type === 'SABOTAGE_FX_BC');
        assert.equal(fx.length, 0, 'Cross-class ability must not execute');

        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        const sab = room.players.find((p: any) => p.id === saboteurs[0].id);
        assert.equal(sab.energy, 60, 'Energy must not be deducted on cross-class ability');
      } finally {
        await harness.cleanup();
      }
    });

    test('3.5 energy accumulation caps at 100 (ENERGY.MAX)', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'CAP TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Starting energy is 60. Advance 15s virtual time (+150 energy)
        t.mock.timers.tick(15000);
        await Promise.resolve();

        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        const sab = room.players.find((p: any) => p.id === saboteurs[0].id);
        assert.equal(sab.energy, ENERGY.MAX, `Energy must cap at ${ENERGY.MAX}, got ${sab.energy}`);
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // Feature 4: Phase State Machine (PREP/SPLASH/LIVE/FREEZE)
  // Source: ORIGINAL_REQUEST.md §R1.1-4, PROJECT.md Feature 9, 10, 11
  // =========================================================================
  describe('Feature 4: Phase State Machine', () => {
    test('4.1 PREP 30s timeout automatically selects fallback headline and advances to SPLASH', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.screen === 'BROADCAST' && s.segment?.phase === 'PREP');

        // Do not submit headline; tick 30,000ms
        t.mock.timers.tick(TIMINGS.PREP_MAX_MS);
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

    test('4.2 non-lead writer submitting headline in PREP is rejected', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        // 6 players provides { writer: 2, artist: 3, saboteur: 1 } matching role slots
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 2,
          artists: 3,
          saboteurs: 1,
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

    test('4.3 artist or saboteur submitting headline in PREP is rejected', async (t) => {
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

    test('4.4 lead writer submitting headline during LIVE or FREEZE is rejected', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ORIGINAL HEADLINE' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'MUTATION DURING LIVE' });
        await flushAsync();
        assert.equal(host.lastSnapshot?.segment?.headline, 'ORIGINAL HEADLINE');

        t.mock.timers.tick(45000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'MUTATION DURING FREEZE' });
        await flushAsync();
        assert.equal(host.lastSnapshot?.segment?.headline, 'ORIGINAL HEADLINE');
      } finally {
        await harness.cleanup();
      }
    });

    test('4.5 rapid duplicate headline submissions only accept the first submission', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'FIRST WINNER' });
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'SECOND LOSER' });

        const splashSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        assert.equal(splashSnap.segment?.headline, 'FIRST WINNER');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // Feature 5: Segment Count Calculation (max(3, numWriters))
  // Source: ORIGINAL_REQUEST.md §R1, PROJECT.md Feature 7
  // =========================================================================
  describe('Feature 5: Segment Count Calculation', () => {
    test('5.1 0 writers in test mode produces exactly 3 segments with auto-editor', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host } = await harness.setupLobby({ playerCount: 3, testMode: true });
        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        for (const p of room.players) p.role = 'artist';
        (harness.roomManager as any).beginBroadcast(room);

        const snap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(snap.segment?.totalSegments, 3, 'max(3, 0) = 3 segments');
        assert.equal(snap.segment?.leadWriterName, 'Авто-редакция');
      } finally {
        await harness.cleanup();
      }
    });

    test('5.2 5 writers produces exactly 5 segments', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host } = await harness.setupLobby({ playerCount: 5, testMode: true });
        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        for (const p of room.players) p.role = 'writer';
        (harness.roomManager as any).beginBroadcast(room);

        const snap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(snap.segment?.totalSegments, 5, 'max(3, 5) = 5 segments');
      } finally {
        await harness.cleanup();
      }
    });

    test('5.3 10 players with 3 writers produces exactly 3 segments', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host } = await harness.setupLobby({ playerCount: 10, testMode: true });
        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        for (let i = 0; i < 3; i++) room.players[i].role = 'writer';
        for (let i = 3; i < 7; i++) room.players[i].role = 'artist';
        for (let i = 7; i < 10; i++) room.players[i].role = 'saboteur';

        (harness.roomManager as any).beginBroadcast(room);
        const snap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(snap.segment?.totalSegments, 3, 'max(3, 3) = 3 segments for 10-player room');
      } finally {
        await harness.cleanup();
      }
    });

    test('5.4 segment lead writer wraps cleanly around writer array', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        // 6 players provides { writer: 2, artist: 3, saboteur: 1 } matching role slots
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 2,
          artists: 3,
          saboteurs: 1,
        });
        t.mock.timers.tick(650);
        const snap0 = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(snap0.segment?.leadWriterId, writers[0].id);

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'H1' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        t.mock.timers.tick(45000);
        t.mock.timers.tick(3000);

        const snap1 = await host.waitForSnapshot((s) => s.segment?.index === 1);
        assert.equal(snap1.segment?.leadWriterId, writers[1].id);

        writers[1].send({ type: 'SUBMIT_HEADLINE', headline: 'H2' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        t.mock.timers.tick(45000);
        t.mock.timers.tick(3000);

        const snap2 = await host.waitForSnapshot((s) => s.segment?.index === 2);
        assert.equal(snap2.segment?.leadWriterId, writers[0].id, 'Segment 2 must wrap back to Writer 0');
      } finally {
        await harness.cleanup();
      }
    });

    test('5.5 disconnected writer handled safely without throwing in rotation', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        // 6 players provides { writer: 2, artist: 3, saboteur: 1 } matching role slots
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 2,
          artists: 3,
          saboteurs: 1,
        });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.screen === 'BROADCAST');

        // Disconnect writer 1 during segment 0
        await writers[1].close();

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'SEG 0 ACTIVE' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        t.mock.timers.tick(45000);
        t.mock.timers.tick(3000);

        const snap1 = await host.waitForSnapshot((s) => s.segment?.index === 1);
        assert.equal(snap1.segment?.index, 1);
        assert.equal(snap1.segment?.leadWriterId, writers[1].id);
        assert.equal(snap1.segment?.phase, 'PREP');

        // Fast-forward 30,000ms, server should transition smoothly to SPLASH with fallback headline
        t.mock.timers.tick(30000);
        const splashSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        assert.equal(splashSnap.segment?.phase, 'SPLASH');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // Feature 6: Lobby & Role Select
  // Source: ORIGINAL_REQUEST.md §R5, AC, PROJECT.md Feature 8
  // =========================================================================
  describe('Feature 6: Lobby & Role Select', () => {
    test('6.1 selecting role when slot capacity is full returns error', async () => {
      const harness = new TestHarness();
      try {
        const { host, players } = await harness.setupLobby({ playerCount: 4 });
        host.send({ type: 'START_GAME' });
        await host.waitForSnapshot((s) => s.screen === 'ROLE_SELECT');

        // 4 players: writer cap is 1
        host.send({ type: 'SELECT_ROLE', role: 'writer' });
        await host.waitForSnapshot((s) => s.players.find((p) => p.id === host.id)?.role === 'writer');

        // Second player attempts to claim writer
        players[0].send({ type: 'SELECT_ROLE', role: 'writer' });
        const err = await players[0].waitFor('ERROR');
        assert.match(err.message, /Слоты на эту роль уже заняты/);
      } finally {
        await harness.cleanup();
      }
    });

    test('6.2 switching role releases previous slot and occupies new slot', async () => {
      const harness = new TestHarness();
      try {
        const { host, players } = await harness.setupLobby({ playerCount: 4 });
        host.send({ type: 'START_GAME' });
        await host.waitForSnapshot((s) => s.screen === 'ROLE_SELECT');

        // Host claims writer
        host.send({ type: 'SELECT_ROLE', role: 'writer' });
        await host.waitForSnapshot((s) => s.players.find((p) => p.id === host.id)?.role === 'writer');

        // Host switches to artist
        host.send({ type: 'SELECT_ROLE', role: 'artist' });
        await host.waitForSnapshot((s) => s.players.find((p) => p.id === host.id)?.role === 'artist');

        // Player 0 can now claim writer
        players[0].send({ type: 'SELECT_ROLE', role: 'writer' });
        const snap = await host.waitForSnapshot(
          (s) => s.players.find((p) => p.id === players[0].id)?.role === 'writer',
        );
        assert.equal(snap.players.find((p) => p.id === players[0].id)?.role, 'writer');
      } finally {
        await harness.cleanup();
      }
    });

    test('6.3 host start game with <4 players without testMode is rejected with error', async () => {
      const harness = new TestHarness();
      try {
        const { host } = await harness.setupLobby({ playerCount: 2, testMode: false });
        host.send({ type: 'START_GAME' });
        const err = await host.waitFor('ERROR');
        assert.match(err.message, /минимум 4 игрока/);
        assert.equal(host.lastSnapshot?.screen, 'LOBBY');
      } finally {
        await harness.cleanup();
      }
    });

    test('6.4 joining room with 10 players returns error', async () => {
      const harness = new TestHarness();
      try {
        const { roomCode } = await harness.setupLobby({ playerCount: 10, testMode: true });
        const overflowClient = await harness.createClient('OverflowPlayer');
        overflowClient.send({ type: 'JOIN_ROOM', roomCode, playerName: 'OverflowPlayer' });
        const err = await overflowClient.waitFor('ERROR');
        assert.match(err.message, /Комната заполнена/);
      } finally {
        await harness.cleanup();
      }
    });

    test('6.5 joining room after game started returns error', async () => {
      const harness = new TestHarness();
      try {
        const { roomCode, host } = await harness.setupLobby({ playerCount: 4 });
        host.send({ type: 'START_GAME' });
        await host.waitForSnapshot((s) => s.screen === 'ROLE_SELECT');

        const lateClient = await harness.createClient('LatePlayer');
        lateClient.send({ type: 'JOIN_ROOM', roomCode, playerName: 'LatePlayer' });
        const err = await lateClient.waitFor('ERROR');
        assert.match(err.message, /Эфир уже начался/);
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // Feature 7: Artist Canvas, Wipers & Forced Brush
  // Source: ORIGINAL_REQUEST.md §R1.3, R4.2, PROJECT.md Feature 16, 17, 34, 35, 36
  // =========================================================================
  describe('Feature 7: Artist Canvas, Wipers & Forced Brush', () => {
    test('7.1 wipers called again within 7000ms cooldown is rejected', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'WIPERS COOLDOWN' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Artist calls wipers
        artists[0].send({ type: 'USE_WIPERS' });
        await host.waitFor('WIPERS_BC');

        // Saboteur places tomato
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.5, y: 0.5 });
        await host.waitFor('SABOTAGE_VISUAL_BC');

        // Advance 3000ms (<7000ms)
        t.mock.timers.tick(3000);
        artists[0].send({ type: 'USE_WIPERS' });

        await flushAsync();
        const wipersBcs = host.drainMessages().filter((m) => m.type === 'WIPERS_BC');
        assert.equal(wipersBcs.length, 0, 'Second wipers within 3s must be rejected');

        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        assert.equal(room.sabotageItems.length, 1, 'Tomato must not be cleared by rejected wipers');
      } finally {
        await harness.cleanup();
      }
    });

    test('7.2 artist A using wipers does not affect artist B wipers cooldown', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
          artists: 2,
        });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'MULTI ARTIST WIPERS' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Artist 0 uses wipers
        artists[0].send({ type: 'USE_WIPERS' });
        const w0 = await host.waitFor('WIPERS_BC', (m) => m.actorId === artists[0].id);
        assert.equal(w0.actorId, artists[0].id);

        // Saboteur places sticker
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'sticker', x: 0.3, y: 0.3 });
        await host.waitFor('SABOTAGE_VISUAL_BC');

        // Artist 1 immediately uses wipers
        artists[1].send({ type: 'USE_WIPERS' });
        const w1 = await host.waitFor('WIPERS_BC', (m) => m.actorId === artists[1].id);
        assert.equal(w1.actorId, artists[1].id);

        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        assert.equal(room.sabotageItems.length, 0, 'Sticker must be cleared by Artist 1');
      } finally {
        await harness.cleanup();
      }
    });

    test('7.3 wipers called when 0 sabotage items exist succeeds and applies cooldown', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'EMPTY WIPERS' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        assert.equal(room.sabotageItems.length, 0);

        artists[0].send({ type: 'USE_WIPERS' });
        const bc = await host.waitFor('WIPERS_BC');
        assert.equal(bc.actorId, artists[0].id);
        assert.ok(bc.cooldownUntil >= Date.now() + 6500);
      } finally {
        await harness.cleanup();
      }
    });

    test('7.4 undo called when 0 items drawn is a safe no-op', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'EMPTY UNDO' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        artists[0].send({ type: 'UNDO_LAST' });
        await flushAsync();

        const undos = host.drainMessages().filter((m) => m.type === 'UNDO_BC');
        assert.equal(undos.length, 0);

        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        assert.equal(room.drawItems.length, 0);
      } finally {
        await harness.cleanup();
      }
    });

    test('7.5 drawing coordinates outside [0.0, 1.0] are clamped', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'CLAMP DRAW' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        artists[0].send({
          type: 'STROKE_START',
          id: 'stroke-clamp-1',
          color: '#3B82F6',
          widthNorm: 0.015,
          point: { x: -0.5, y: 1.8 },
        });
        const startBc = await host.waitFor('STROKE_START_BC');
        assert.equal(startBc.item.points[0].x, 0.0, 'Negative x must clamp to 0.0');
        assert.equal(startBc.item.points[0].y, 1.0, 'y > 1.0 must clamp to 1.0');

        artists[0].send({
          type: 'PLACE_STAMP',
          id: 'stamp-clamp-1',
          stampId: 'star',
          color: '#F59E0B',
          x: 1.5,
          y: -0.2,
        });
        const stampBc = await host.waitFor('STAMP_ADD_BC');
        assert.equal(stampBc.item.x, 1.0, 'x > 1.0 must clamp to 1.0');
        assert.equal(stampBc.item.y, 0.0, 'Negative y must clamp to 0.0');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // Feature 8: Writer Headline & Ticker Mechanics
  // Source: ORIGINAL_REQUEST.md §R1.1, R1.3, PROJECT.md Feature 10, 11
  // =========================================================================
  describe('Feature 8: Writer Headline & Ticker Mechanics', () => {
    test('8.1 headline longer than 90 characters is truncated to 90', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        const longHeadline = 'СРОЧНАЯ НОВОСТЬ '.repeat(10);
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: longHeadline });
        const snap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        assert.equal(snap.segment?.headline.length, 90, 'Headline length must be truncated to 90');
      } finally {
        await harness.cleanup();
      }
    });

    test('8.2 ticker text longer than 100 characters is truncated to 100', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'TICKER TRUNC' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const longTicker = 'ФАКТ В БЕГУЩУЮ СТРОКУ '.repeat(10);
        writers[0].send({ type: 'ADD_TICKER', text: longTicker });
        const bc = await host.waitFor('TICKER_ADD_BC');
        assert.equal(bc.message.text.length, 100, 'Ticker text must be sliced to 100 characters');
      } finally {
        await harness.cleanup();
      }
    });

    test('8.3 ticker message with only whitespace is rejected', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'WHITESPACE TICKER' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        writers[0].send({ type: 'ADD_TICKER', text: '     \t\n   ' });
        await flushAsync();

        const bcs = host.drainMessages().filter((m) => m.type === 'TICKER_ADD_BC');
        assert.equal(bcs.length, 0, 'Whitespace ticker must not broadcast');

        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        assert.equal(room.ticker.length, 0);
      } finally {
        await harness.cleanup();
      }
    });

    test('8.4 ticker submitted during PREP or SPLASH is rejected', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        // Attempt during PREP
        writers[0].send({ type: 'ADD_TICKER', text: 'TICKER IN PREP' });
        await flushAsync();
        assert.equal(host.drainMessages().filter((m) => m.type === 'TICKER_ADD_BC').length, 0);

        // Transition to SPLASH
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'TEST HEADLINE' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');

        // Attempt during SPLASH
        writers[0].send({ type: 'ADD_TICKER', text: 'TICKER IN SPLASH' });
        await flushAsync();
        assert.equal(host.drainMessages().filter((m) => m.type === 'TICKER_ADD_BC').length, 0);
      } finally {
        await harness.cleanup();
      }
    });

    test('8.5 ticker buffer caps at 15 messages discarding oldest on overflow', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'OVERFLOW' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        for (let i = 1; i <= 18; i++) {
          writers[0].send({ type: 'ADD_TICKER', text: `Message #${i}` });
          await host.waitFor('TICKER_ADD_BC', (m) => m.message.text === `Message #${i}`);
        }

        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        assert.equal(room.ticker.length, 15, 'Buffer must cap at exactly 15 messages');
        assert.equal(room.ticker[0].text, 'Message #4', 'First message should be #4 (1, 2, 3 discarded)');
        assert.equal(room.ticker[14].text, 'Message #18', 'Latest message should be #18');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // Feature 9: Replay Compilation & ReplayAnalyzer
  // Source: ORIGINAL_REQUEST.md §R2.1-3, PROJECT.md Interface Contract 3
  // =========================================================================
  describe('Feature 9: Replay Compilation & ReplayAnalyzer', () => {
    test('9.1 zero reactions and sabotage computes valid replay payload without NaN', () => {
      const seg = {
        segmentIndex: 0,
        headline: 'CALM HEADLINE',
        writerName: 'Writer Calm',
        sourceDurationMs: 35000,
        events: [
          { t: 0, type: 'PHASE' as const, phase: 'SPLASH' as const },
          { t: 1200, type: 'PHASE' as const, phase: 'LIVE' as const },
          { t: 34000, type: 'PHASE' as const, phase: 'FREEZE' as const },
        ],
      };
      const payload = buildReplayPayload([seg, { ...seg, segmentIndex: 1 }, { ...seg, segmentIndex: 2 }], Date.now());

      assert.equal(Number.isNaN(payload.totalPlaybackDurationMs), false, 'Duration must not be NaN');
      assert.ok(payload.totalPlaybackDurationMs > 0, 'Duration must be positive');
      for (const r of payload.speedRanges) {
        assert.equal(Number.isNaN(r.speed), false, 'Speed must not be NaN');
        assert.ok(r.speed >= 2.5 && r.speed <= 3.5, 'Speed must be finite in valid range [2.5, 3.5]');
      }
    });

    test('9.2 dense burst of >200 events maintains total duration within [40000, 55000] ms', () => {
      const events = [
        { t: 0, type: 'PHASE' as const, phase: 'SPLASH' as const },
        { t: 1200, type: 'PHASE' as const, phase: 'LIVE' as const },
      ];
      for (let i = 0; i < 220; i++) {
        events.push({
          t: 2000 + i * 100,
          type: 'REACTION' as const,
          id: `burst-${i}`,
          emoji: '😂',
          lane: 0.5,
          senderId: 's1',
        });
      }
      events.push({ t: 34000, type: 'PHASE' as const, phase: 'FREEZE' as const });

      const seg = {
        segmentIndex: 0,
        headline: 'DENSE MATCH',
        writerName: 'Writer Dense',
        sourceDurationMs: 35000,
        events,
      };
      const payload = buildReplayPayload([seg, { ...seg, segmentIndex: 1 }, { ...seg, segmentIndex: 2 }], Date.now());

      assert.ok(
        payload.totalPlaybackDurationMs >= 40000 && payload.totalPlaybackDurationMs <= 55000,
        `Duration with dense burst must be in [40000, 55000] ms, got ${payload.totalPlaybackDurationMs}`,
      );
    });

    test('9.3 standard 3-segment match duration respects >= 40000 ms bound', () => {
      function makeFullSeg(idx: number) {
        return {
          segmentIndex: idx,
          headline: `SEG ${idx}`,
          writerName: `Writer ${idx}`,
          sourceDurationMs: TIMINGS.SPLASH_MS + TIMINGS.LIVE_MS + TIMINGS.FREEZE_MS,
          events: [
            { t: 0, type: 'PHASE' as const, phase: 'SPLASH' as const },
            { t: 3000, type: 'PHASE' as const, phase: 'LIVE' as const },
            { t: 5000, type: 'REACTION' as const, id: `r-${idx}`, emoji: '😂', lane: 0.5, senderId: 's1' },
            { t: 50000, type: 'PHASE' as const, phase: 'FREEZE' as const },
          ],
        };
      }
      const payload = buildReplayPayload([makeFullSeg(0), makeFullSeg(1), makeFullSeg(2)], Date.now());
      assert.ok(
        payload.totalPlaybackDurationMs >= 40000,
        `Duration must be >= 40000 ms, got ${payload.totalPlaybackDurationMs}`,
      );
    });

    test('9.4 full standard broadcast match duration never exceeds 55000 ms', () => {
      function makeFullSeg(idx: number) {
        return {
          segmentIndex: idx,
          headline: `FULL ${idx}`,
          writerName: `Writer ${idx}`,
          sourceDurationMs: TIMINGS.SPLASH_MS + TIMINGS.LIVE_MS + TIMINGS.FREEZE_MS,
          events: [
            { t: 0, type: 'PHASE' as const, phase: 'SPLASH' as const },
            { t: 3000, type: 'PHASE' as const, phase: 'LIVE' as const },
            { t: 10000, type: 'REACTION' as const, id: `r-${idx}-1`, emoji: '😂', lane: 0.5, senderId: 's1' },
            { t: 10200, type: 'REACTION' as const, id: `r-${idx}-2`, emoji: '👏', lane: 0.5, senderId: 's1' },
            { t: 50000, type: 'PHASE' as const, phase: 'FREEZE' as const },
          ],
        };
      }
      const payload = buildReplayPayload([makeFullSeg(0), makeFullSeg(1), makeFullSeg(2)], Date.now());
      assert.ok(
        payload.totalPlaybackDurationMs <= 55000,
        `Total duration must be <= 55000 ms, got ${payload.totalPlaybackDurationMs}`,
      );
    });

    test('9.5 base speed lower bound is clamped at >= 2.5x even for short matches', () => {
      function makeTinySeg(idx: number) {
        return {
          segmentIndex: idx,
          headline: `TINY ${idx}`,
          writerName: `Writer ${idx}`,
          sourceDurationMs: 25000,
          events: [
            { t: 0, type: 'PHASE' as const, phase: 'SPLASH' as const },
            { t: 1000, type: 'PHASE' as const, phase: 'LIVE' as const },
            { t: 24000, type: 'PHASE' as const, phase: 'FREEZE' as const },
          ],
        };
      }
      const payload = buildReplayPayload([makeTinySeg(0), makeTinySeg(1), makeTinySeg(2)], Date.now());
      const nonPeaks = payload.speedRanges.filter((r) => !r.isPeak);
      for (const r of nonPeaks) {
        assert.ok(
          r.speed >= 2.5,
          `Base speed must be clamped at >= 2.5x, got ${r.speed}`,
        );
      }
    });
  });

  // =========================================================================
  // Feature 10: Room Lifecycle & Reconnect
  // Source: ORIGINAL_REQUEST.md §R5, PROJECT.md M1, Feature 40
  // =========================================================================
  describe('Feature 10: Room Lifecycle & Reconnect', () => {
    test('10.1 reconnect with invalid token returns error', async () => {
      const harness = new TestHarness();
      try {
        const host = await harness.createClient('Host');
        const hostSnap = await host.createRoom('Host');

        const rogue = await harness.createClient('Rogue');
        rogue.send({ type: 'RECONNECT', roomCode: hostSnap.roomCode, token: 'invalid-token-123' });
        const err = await rogue.waitFor('ERROR');
        assert.match(err.message, /Сессия не найдена/);
      } finally {
        await harness.cleanup();
      }
    });

    test('10.2 reconnect to non-existent room code returns error', async () => {
      const harness = new TestHarness();
      try {
        const client = await harness.createClient('Client');
        client.send({ type: 'RECONNECT', roomCode: '0000', token: 'token-xyz' });
        const err = await client.waitFor('ERROR');
        assert.match(err.message, /Комната больше не существует/);
      } finally {
        await harness.cleanup();
      }
    });

    test('10.3 room cleaned up after 120s timeout when all players disconnect', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { roomCode, clients } = await harness.setupLobby({ playerCount: 2 });
        assert.ok((harness.roomManager as any).rooms.has(roomCode));

        for (const c of clients) {
          await c.close();
        }

        t.mock.timers.tick(120000);
        await Promise.resolve();

        assert.equal(
          (harness.roomManager as any).rooms.has(roomCode),
          false,
          'Room must be deleted from memory after 120s idle timeout',
        );
      } finally {
        await harness.cleanup();
      }
    });

    test('10.4 host disconnect with only bots does not grant host status to bots', async () => {
      const harness = new TestHarness();
      try {
        const host = await harness.createClient('Host');
        const snap = await host.createRoom('Host');
        host.send({ type: 'ADD_BOT' });
        await host.waitForSnapshot((s) => s.players.length === 2);

        const room = (harness.roomManager as any).rooms.get(snap.roomCode);
        const bot = room.players.find((p: any) => p.isBot);
        assert.ok(bot);
        assert.equal(bot.isHost, false);

        await host.close();

        assert.equal(bot.isHost, false, 'Bot must never be granted host status');
      } finally {
        await harness.cleanup();
      }
    });

    test('10.5 host disconnects and reconnects recovering session cleanly', async () => {
      const harness = new TestHarness();
      try {
        const host = await harness.createClient('HostPlayer');
        const hostSnap = await host.createRoom('HostPlayer');
        const originalToken = host.token;
        const originalId = host.id;

        await host.close();

        const reconHost = await harness.createClient('HostPlayer');
        const reconSnap = await reconHost.reconnect(hostSnap.roomCode, originalToken);

        assert.equal(reconHost.id, originalId, 'Host ID must be preserved');
        assert.equal(reconSnap.hostId, originalId, 'Room hostId must remain Host ID');
        const hostEntry = reconSnap.players.find((p) => p.id === originalId);
        assert.equal(hostEntry?.isHost, true);
        assert.equal(hostEntry?.connected, true);
      } finally {
        await harness.cleanup();
      }
    });
  });
});
