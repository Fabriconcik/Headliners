import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { TestHarness } from './harness.js';
import { extractSingleEmoji } from '../../shared/emoji.js';
import { buildReplayPayload } from '../../server/replayAnalyzer.js';
import {
  ENERGY,
  FALLBACK_HEADLINES,
  FORCED_BRUSH,
  QUICK_REACTIONS,
  TIMINGS,
  computeRoleSlots,
} from '../../shared/constants.js';

describe('Tier 1: Feature Coverage E2E Test Suite', () => {
  // =========================================================================
  // Feature 1: Single-Emoji Validator
  // Source: ORIGINAL_REQUEST.md §R3.3, PROJECT.md Interface Contract 1
  // =========================================================================
  describe('Feature 1: Single-Emoji Validator', () => {
    test('1.1 accepts standard single emoji cluster', () => {
      const input = '😂';
      const result = extractSingleEmoji(input);
      assert.equal(result, '😂', 'Standard emoji must be accepted verbatim');
    });

    test('1.2 accepts multi-codepoint ZWJ family sequence', () => {
      const input = '👨‍👩‍👧‍👦';
      const result = extractSingleEmoji(input);
      assert.equal(result, '👨‍👩‍👧‍👦', 'ZWJ grapheme cluster must be treated as a single emoji');
    });

    test('1.3 accepts single emoji with skin tone modifier', () => {
      const input = '👍🏽';
      const result = extractSingleEmoji(input);
      assert.equal(result, '👍🏽', 'Emoji with Fitzpatrick skin tone modifier must be accepted');
    });

    test('1.4 accepts regional indicator flag sequence', () => {
      const input = '🇯🇵';
      const result = extractSingleEmoji(input);
      assert.equal(result, '🇯🇵', 'Regional indicator flag sequence must be accepted');
    });

    test('1.5 accepts keycap sequence with combining enclosing keycap', () => {
      const input = '1️⃣';
      const result = extractSingleEmoji(input);
      assert.equal(result, '1️⃣', 'Keycap sequence must be accepted as single emoji');
    });
  });

  // =========================================================================
  // Feature 2: Emoji Antispam Rate Limit
  // Source: ORIGINAL_REQUEST.md §R3.1, §R3.2, §R3.3, PROJECT.md Feature 2
  // =========================================================================
  describe('Feature 2: Emoji Antispam Rate Limit', () => {
    test('2.1 single reaction in LIVE is accepted and broadcast', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'RATE LIMIT TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😂' });
        const reaction = await host.waitFor('REACTION_BC');
        assert.equal(reaction.emoji, '😂');
        assert.equal(reaction.senderId, saboteurs[0].id);
      } finally {
        await harness.cleanup();
      }
    });

    test('2.2 reaction after 300ms cooldown (>250ms) is accepted', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'COOLDOWN TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😂' });
        const r1 = await host.waitFor('REACTION_BC');
        assert.equal(r1.emoji, '😂');

        t.mock.timers.tick(300);
        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😱' });
        const r2 = await host.waitFor('REACTION_BC');
        assert.equal(r2.emoji, '😱');
      } finally {
        await harness.cleanup();
      }
    });

    test('2.3 spaced reactions stream is completely accepted', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'STREAM TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const emojis = ['😂', '👏', '🤦'];
        for (const emoji of emojis) {
          saboteurs[0].send({ type: 'SEND_REACTION', emoji });
          const bc = await host.waitFor('REACTION_BC', (m) => m.emoji === emoji);
          assert.equal(bc.emoji, emoji);
          t.mock.timers.tick(260);
        }
      } finally {
        await harness.cleanup();
      }
    });

    test('2.4 all 4 quick reaction presets broadcast with 0 energy cost', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'PRESETS TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        const liveSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const sabInitialEnergy = liveSnap.players.find((p) => p.id === saboteurs[0].id)?.energy ?? 60;

        for (const preset of QUICK_REACTIONS) {
          saboteurs[0].send({ type: 'SEND_REACTION', emoji: preset });
          const bc = await host.waitFor('REACTION_BC', (m) => m.emoji === preset);
          assert.equal(bc.emoji, preset);
          t.mock.timers.tick(260);
        }

        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        const sabPlayer = room.players.find((p: any) => p.id === saboteurs[0].id);
        assert.ok(
          sabPlayer.energy >= sabInitialEnergy,
          'Quick reactions must cost 0 energy and not decrement saboteur energy',
        );
      } finally {
        await harness.cleanup();
      }
    });

    test('2.5 custom single emoji reaction is accepted and broadcast', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'CUSTOM EMOJI' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const customEmoji = '🚀';
        saboteurs[0].send({ type: 'SEND_REACTION', emoji: customEmoji });
        const bc = await host.waitFor('REACTION_BC', (m) => m.emoji === customEmoji);
        assert.equal(bc.emoji, customEmoji);
        assert.equal(bc.senderId, saboteurs[0].id);
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
    test('3.1 saboteur starting energy in LIVE is >= 60', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ENERGY TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        const liveSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const sab = liveSnap.players.find((p) => p.id === saboteurs[0].id);
        assert.ok(sab, 'Saboteur must exist in snapshot');
        assert.ok(sab.energy >= ENERGY.START, `Starting energy must be >= ${ENERGY.START}, got ${sab.energy}`);
      } finally {
        await harness.cleanup();
      }
    });

    test('3.2 energy regenerates at +10/sec up to max 100', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'REGEN TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Saboteur uses tomato (cost 25)
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.5, y: 0.5 });
        const energyUpdate1 = await saboteurs[0].waitFor('ENERGY_UPDATE');
        assert.equal(energyUpdate1.energy, 35);

        // Advance 5 seconds virtual time (+50 energy)
        t.mock.timers.tick(5000);
        await Promise.resolve();

        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        const sabPlayer = room.players.find((p: any) => p.id === saboteurs[0].id);
        assert.ok(sabPlayer.energy >= 85, `Energy should have regenerated to >=85, got ${sabPlayer.energy}`);

        // Advance another 5 seconds virtual time (should cap at 100)
        t.mock.timers.tick(5000);
        await Promise.resolve();
        assert.equal(sabPlayer.energy, ENERGY.MAX, `Energy must cap at ${ENERGY.MAX}`);
      } finally {
        await harness.cleanup();
      }
    });

    test('3.3 Vandal casts tomato (cost 25) decrements energy and broadcasts visual', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles({
          saboteurClasses: ['vandal'],
        });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'VANDAL TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.4, y: 0.6 });
        const energyUpdate = await saboteurs[0].waitFor('ENERGY_UPDATE');
        assert.equal(energyUpdate.energy, 35, 'Cost 25 deducted from 60 leaves 35');

        const visual = await host.waitFor('SABOTAGE_VISUAL_BC');
        assert.equal(visual.item.type, 'tomato');
        assert.equal(visual.item.x, 0.4);
        assert.equal(visual.item.y, 0.6);
      } finally {
        await harness.cleanup();
      }
    });

    test('3.4 Hacker casts glitch (cost 50) decrements energy and broadcasts FX', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles({
          saboteurClasses: ['hacker'],
        });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'HACKER TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'glitch' });
        const energyUpdate = await saboteurs[0].waitFor('ENERGY_UPDATE');
        assert.equal(energyUpdate.energy, 10, 'Cost 50 deducted from 60 leaves 10');

        const fx = await host.waitFor('SABOTAGE_FX_BC', (m) => m.fx === 'glitch');
        assert.equal(fx.fx, 'glitch');
        assert.ok(fx.until > Date.now(), 'glitch until timestamp must be in future');
      } finally {
        await harness.cleanup();
      }
    });

    test('3.5 Director casts forced_brush (cost 55) decrements energy and broadcasts FX', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles({
          saboteurClasses: ['director'],
        });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'DIRECTOR TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'forced_brush' });
        const energyUpdate = await saboteurs[0].waitFor('ENERGY_UPDATE');
        assert.equal(energyUpdate.energy, 5, 'Cost 55 deducted from 60 leaves 5');

        const fx = await host.waitFor('SABOTAGE_FX_BC', (m) => m.fx === 'forced_brush');
        assert.equal(fx.fx, 'forced_brush');
        assert.ok(fx.until > Date.now(), 'forced_brush until timestamp must be in future');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // Feature 4: Phase State Machine (PREP/SPLASH/LIVE/FREEZE)
  // Source: ORIGINAL_REQUEST.md §R1.1-4, PROJECT.md Feature 9, 12, 13, 14
  // =========================================================================
  describe('Feature 4: Phase State Machine', () => {
    test('4.1 PREP phase initializes with 30s timer for human lead writer', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        const prepSnap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST' && s.segment?.phase === 'PREP');
        assert.ok(prepSnap.segment, 'Segment must exist');
        const duration = prepSnap.segment.phaseEndsAt - prepSnap.segment.phaseStartedAt;
        assert.equal(duration, TIMINGS.PREP_MAX_MS, 'PREP timer must be exactly 30,000ms');
      } finally {
        await harness.cleanup();
      }
    });

    test('4.2 lead writer early submit advances to SPLASH immediately', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ЭКСТРЕННЫЙ ВЫПУСК' });
        const splashSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        assert.equal(splashSnap.segment?.phase, 'SPLASH');
        assert.equal(splashSnap.segment?.headline, 'ЭКСТРЕННЫЙ ВЫПУСК');
      } finally {
        await harness.cleanup();
      }
    });

    test('4.3 SPLASH 3s timer advances to LIVE', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'TEST' });
        const splashSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        const splashDuration = splashSnap.segment!.phaseEndsAt - splashSnap.segment!.phaseStartedAt;
        assert.equal(splashDuration, TIMINGS.SPLASH_MS, 'SPLASH duration must be 3,000ms');

        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        const liveSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
        assert.equal(liveSnap.segment?.phase, 'LIVE');
      } finally {
        await harness.cleanup();
      }
    });

    test('4.4 LIVE 45s timer advances to FREEZE', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        const liveSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
        const liveDuration = liveSnap.segment!.phaseEndsAt - liveSnap.segment!.phaseStartedAt;
        assert.equal(liveDuration, TIMINGS.LIVE_MS, 'LIVE duration must be 45,000ms');

        t.mock.timers.tick(TIMINGS.LIVE_MS);
        const freezeSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
        assert.equal(freezeSnap.segment?.phase, 'FREEZE');
      } finally {
        await harness.cleanup();
      }
    });

    test('4.5 FREEZE 3s timer advances to next segment PREP or REPLAY', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
        t.mock.timers.tick(45000);
        const freezeSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
        assert.equal(freezeSnap.segment?.index, 0);

        t.mock.timers.tick(TIMINGS.FREEZE_MS);
        const nextPrepSnap = await host.waitForSnapshot(
          (s) => s.screen === 'BROADCAST' && s.segment?.phase === 'PREP' && s.segment?.index === 1,
        );
        assert.equal(nextPrepSnap.segment?.index, 1, 'Segment index must increment to 1');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // Feature 5: Segment Count Calculation (max(3, numWriters))
  // Source: ORIGINAL_REQUEST.md §R1, PROJECT.md Feature 7, AC
  // =========================================================================
  describe('Feature 5: Segment Count Calculation', () => {
    test('5.1 1 writer produces exactly 3 segments', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host } = await harness.setupGameWithRoles({ writers: 1, artists: 2, saboteurs: 1 });
        t.mock.timers.tick(650);
        const snap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(snap.segment?.totalSegments, 3, 'max(3, 1) = 3 segments');
      } finally {
        await harness.cleanup();
      }
    });

    test('5.2 2 writers produces exactly 3 segments', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host } = await harness.setupGameWithRoles({ writers: 2, artists: 3, saboteurs: 1 });
        t.mock.timers.tick(650);
        const snap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(snap.segment?.totalSegments, 3, 'max(3, 2) = 3 segments');
      } finally {
        await harness.cleanup();
      }
    });

    test('5.3 3 writers produces exactly 3 segments', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host } = await harness.setupGameWithRoles({ writers: 3, artists: 4, saboteurs: 3 });
        t.mock.timers.tick(650);
        const snap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(snap.segment?.totalSegments, 3, 'max(3, 3) = 3 segments');
      } finally {
        await harness.cleanup();
      }
    });

    test('5.4 4 writers produces exactly 4 segments', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host } = await harness.setupLobby({ playerCount: 4, testMode: true });
        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        for (const p of room.players) p.role = 'writer';
        (harness.roomManager as any).beginBroadcast(room);
        const snap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(snap.segment?.totalSegments, 4, 'max(3, 4) = 4 segments');
      } finally {
        await harness.cleanup();
      }
    });

    test('5.5 writer queue rotates sequentially across segments', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles({ writers: 2, artists: 3, saboteurs: 1 });
        t.mock.timers.tick(650);
        const snap0 = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(snap0.segment?.leadWriterId, writers[0].id, 'Segment 0 lead is Writer 1');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'SEG 1' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000); // to LIVE
        t.mock.timers.tick(45000); // to FREEZE
        t.mock.timers.tick(3000); // to PREP 1

        const snap1 = await host.waitForSnapshot((s) => s.segment?.index === 1);
        assert.equal(snap1.segment?.leadWriterId, writers[1].id, 'Segment 1 lead rotates to Writer 2');

        writers[1].send({ type: 'SUBMIT_HEADLINE', headline: 'SEG 2' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        t.mock.timers.tick(45000);
        t.mock.timers.tick(3000);

        const snap2 = await host.waitForSnapshot((s) => s.segment?.index === 2);
        assert.equal(snap2.segment?.leadWriterId, writers[0].id, 'Segment 2 lead wraps back to Writer 1');
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
    test('6.1 START_GAME transitions to ROLE_SELECT with 15s timer', async (t) => {
      const harness = new TestHarness();
      try {
        const { host } = await harness.setupLobby({ playerCount: 4 });
        host.send({ type: 'START_GAME' });
        const snap = await host.waitForSnapshot((s) => s.screen === 'ROLE_SELECT');
        assert.equal(snap.screen, 'ROLE_SELECT');
        const remainingMs = snap.roleSelectEndsAt - snap.serverNow;
        assert.ok(
          remainingMs >= 14000 && remainingMs <= 15000,
          `Timer must be ~15,000ms, got ${remainingMs}`,
        );
      } finally {
        await harness.cleanup();
      }
    });

    test('6.2 4-player slot computation provides { writer: 1, artist: 2, saboteur: 1 }', async () => {
      const slots = computeRoleSlots(4, false);
      assert.deepEqual(slots, { writer: 1, artist: 2, saboteur: 1 });
    });

    test('6.3 player claims available role and snapshot updates', async () => {
      const harness = new TestHarness();
      try {
        const { host, players } = await harness.setupLobby({ playerCount: 4 });
        host.send({ type: 'START_GAME' });
        await host.waitForSnapshot((s) => s.screen === 'ROLE_SELECT');

        players[0].send({ type: 'SELECT_ROLE', role: 'artist' });
        const snap = await host.waitForSnapshot(
          (s) => s.players.find((p) => p.id === players[0].id)?.role === 'artist',
        );
        const p0 = snap.players.find((p) => p.id === players[0].id);
        assert.equal(p0?.role, 'artist');
      } finally {
        await harness.cleanup();
      }
    });

    test('6.4 all players ready triggers early advance before 15s timeout', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host } = await harness.setupGameWithRoles();
        // Check fast advance delay (650ms)
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
        assert.equal(host.lastSnapshot?.screen, 'BROADCAST');
      } finally {
        await harness.cleanup();
      }
    });

    test('6.5 15s timeout automatically assigns unassigned players to open slots', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host } = await harness.setupLobby({ playerCount: 4 });
        host.send({ type: 'START_GAME' });
        await host.waitForSnapshot((s) => s.screen === 'ROLE_SELECT');

        // Let 15s timer expire without selecting roles
        t.mock.timers.tick(TIMINGS.ROLE_SELECT_MS);
        const snap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');

        assert.equal(snap.screen, 'BROADCAST');
        for (const p of snap.players) {
          assert.ok(p.role !== null, `Player ${p.name} must have been assigned a role`);
        }
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
    test('7.1 stroke start and points broadcast to all clients', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'DRAW TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const strokeId = 'stroke-7-1';
        artists[0].send({
          type: 'STROKE_START',
          id: strokeId,
          color: '#3B82F6',
          widthNorm: 0.015,
          point: { x: 0.1, y: 0.2 },
        });
        const startBc = await host.waitFor('STROKE_START_BC', (m) => m.item.id === strokeId);
        assert.equal(startBc.item.color, '#3B82F6');
        assert.equal(startBc.item.points[0].x, 0.1);

        artists[0].send({
          type: 'STROKE_POINTS',
          id: strokeId,
          points: [{ x: 0.15, y: 0.25 }],
        });
        const ptsBc = await host.waitFor('STROKE_POINTS_BC', (m) => m.id === strokeId);
        assert.equal(ptsBc.points[0].x, 0.15);
      } finally {
        await harness.cleanup();
      }
    });

    test('7.2 stamp placement broadcasts to all clients', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'STAMP TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const stampId = 'stamp-7-2';
        artists[0].send({
          type: 'PLACE_STAMP',
          id: stampId,
          stampId: 'star',
          color: '#F59E0B',
          x: 0.5,
          y: 0.5,
        });
        const stampBc = await host.waitFor('STAMP_ADD_BC', (m) => m.item.id === stampId);
        assert.equal(stampBc.item.stampId, 'star');
        assert.equal(stampBc.item.x, 0.5);
      } finally {
        await harness.cleanup();
      }
    });

    test('7.3 wipers clears sabotage layer, preserves drawings, and applies 7s cooldown', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'WIPERS TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Saboteur adds tomato
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.5, y: 0.5 });
        const visualBc = await host.waitFor('SABOTAGE_VISUAL_BC');
        assert.equal(visualBc.item.type, 'tomato');

        // Artist adds stamp
        artists[0].send({
          type: 'PLACE_STAMP',
          id: 'preserve-stamp',
          stampId: 'heart',
          color: '#EF4444',
          x: 0.2,
          y: 0.2,
        });
        const stampBc = await host.waitFor('STAMP_ADD_BC');
        assert.equal(stampBc.item.id, 'preserve-stamp');

        // Artist uses wipers
        artists[0].send({ type: 'USE_WIPERS' });
        const wipersBc = await host.waitFor('WIPERS_BC');
        assert.equal(wipersBc.actorId, artists[0].id);
        assert.ok(
          wipersBc.cooldownUntil >= Date.now() + 6500,
          'Wipers cooldown must be set to ~7000ms',
        );

        // Verify on server room state
        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        assert.equal(room.sabotageItems.length, 0, 'Sabotage layer must be completely cleared');
        assert.equal(room.drawItems.length, 1, 'Artist drawing items must be fully preserved');
        assert.equal(room.drawItems[0].id, 'preserve-stamp');

        const artistInfo = room.players.find((p: any) => p.id === artists[0].id);
        assert.ok(
          artistInfo.wipersCooldownUntil >= Date.now() + 6500,
          'Wipers cooldown must be set to ~7000ms',
        );
      } finally {
        await harness.cleanup();
      }
    });

    test('7.4 personal undo removes author\'s latest item only', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists } = await harness.setupGameWithRoles({ artists: 2 });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'UNDO TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Artist 0 places stamp A
        artists[0].send({
          type: 'PLACE_STAMP',
          id: 'item-artist-0',
          stampId: 'star',
          color: '#F59E0B',
          x: 0.2,
          y: 0.2,
        });
        await host.waitFor('STAMP_ADD_BC', (m) => m.item.id === 'item-artist-0');

        // Artist 1 places stamp B
        artists[1].send({
          type: 'PLACE_STAMP',
          id: 'item-artist-1',
          stampId: 'cat',
          color: '#10B981',
          x: 0.8,
          y: 0.8,
        });
        await host.waitFor('STAMP_ADD_BC', (m) => m.item.id === 'item-artist-1');

        // Artist 1 invokes personal undo
        artists[1].send({ type: 'UNDO_LAST' });
        const undoBc = await host.waitFor('UNDO_BC');
        assert.equal(undoBc.itemId, 'item-artist-1');

        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        assert.equal(room.drawItems.length, 1, 'Only one item should remain after undo');
        assert.equal(room.drawItems[0].id, 'item-artist-0', 'Artist 0 item must remain untouched');
      } finally {
        await harness.cleanup();
      }
    });

    test('7.5 forced brush overrides stroke color to #FF10F0 and width to 0.075', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
          saboteurClasses: ['director'],
        });
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'FORCED BRUSH' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Director casts forced_brush
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'forced_brush' });
        await host.waitFor('SABOTAGE_FX_BC', (m) => m.fx === 'forced_brush');

        // Artist attempts to draw with green #10B981 and thin width 0.0065
        artists[0].send({
          type: 'STROKE_START',
          id: 'forced-check-1',
          color: '#10B981',
          widthNorm: 0.0065,
          point: { x: 0.3, y: 0.3 },
        });
        const bc = await host.waitFor('STROKE_START_BC', (m) => m.item.id === 'forced-check-1');
        assert.equal(bc.item.color, FORCED_BRUSH.color, 'Color must be forced to acid pink #FF10F0');
        assert.equal(bc.item.widthNorm, FORCED_BRUSH.widthNorm, 'Width must be forced to 0.075');
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
    test('8.1 lead writer submits headline in PREP saved in uppercase', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'срочные новости выпуска' });
        const snap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        assert.equal(snap.segment?.headline, 'СРОЧНЫЕ НОВОСТИ ВЫПУСКА');
      } finally {
        await harness.cleanup();
      }
    });

    test('8.2 empty headline receives random fallback from FALLBACK_HEADLINES', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: '   ' });
        const snap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        assert.ok(
          FALLBACK_HEADLINES.includes(snap.segment?.headline as any),
          `Headline "${snap.segment?.headline}" must be in FALLBACK_HEADLINES`,
        );
      } finally {
        await harness.cleanup();
      }
    });

    test('8.3 ADD_TICKER broadcasts ticker message to all clients in LIVE', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'TICKER TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const tickerText = 'Коты захватили здание администрации';
        writers[0].send({ type: 'ADD_TICKER', text: tickerText });
        const bc = await host.waitFor('TICKER_ADD_BC');
        assert.equal(bc.message.text, tickerText);
        assert.equal(bc.message.authorName, writers[0].name);
      } finally {
        await harness.cleanup();
      }
    });

    test('8.4 multiple ticker messages preserve chronological order', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ORDER TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        writers[0].send({ type: 'ADD_TICKER', text: 'Строка 1' });
        const tick1 = await host.waitFor('TICKER_ADD_BC', (m) => m.message.text === 'Строка 1');
        assert.equal(tick1.message.text, 'Строка 1');

        writers[0].send({ type: 'ADD_TICKER', text: 'Строка 2' });
        const tick2 = await host.waitFor('TICKER_ADD_BC', (m) => m.message.text === 'Строка 2');
        assert.equal(tick2.message.text, 'Строка 2');

        const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
        assert.equal(room.ticker.length, 2, 'Room must have 2 ticker messages');
        assert.equal(room.ticker[0].text, 'Строка 1');
        assert.equal(room.ticker[1].text, 'Строка 2');
      } finally {
        await harness.cleanup();
      }
    });

    test('8.5 ticker text longer than 100 characters is truncated', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles();
        t.mock.timers.tick(650);
        await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'TRUNCATE TEST' });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(3000);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        const longText = 'A'.repeat(150);
        writers[0].send({ type: 'ADD_TICKER', text: longText });
        const bc = await host.waitFor('TICKER_ADD_BC');
        assert.equal(bc.message.text.length, 100, 'Ticker text must be sliced to 100 characters');
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
    function createMockSegment(idx: number, durationMs = 35000) {
      return {
        segmentIndex: idx,
        headline: `HEADLINE ${idx + 1}`,
        writerName: `Writer ${idx + 1}`,
        sourceDurationMs: durationMs,
        events: [
          { t: 0, type: 'PHASE' as const, phase: 'SPLASH' as const },
          { t: 1200, type: 'PHASE' as const, phase: 'LIVE' as const },
          { t: 5000, type: 'REACTION' as const, id: `r-${idx}-1`, emoji: '😂', lane: 0.5, senderId: 's1' },
          { t: 5200, type: 'REACTION' as const, id: `r-${idx}-2`, emoji: '😂', lane: 0.5, senderId: 's1' },
          { t: 5400, type: 'REACTION' as const, id: `r-${idx}-3`, emoji: '😂', lane: 0.5, senderId: 's1' },
          { t: durationMs - 1000, type: 'PHASE' as const, phase: 'FREEZE' as const },
        ],
      };
    }

    test('9.1 replay payload excludes PREP phase events', () => {
      const segs = [createMockSegment(0), createMockSegment(1), createMockSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      const hasPrep = payload.events.some((e) => e.type === 'PHASE' && (e as any).phase === 'PREP');
      assert.equal(hasPrep, false, 'Replay timeline must strictly exclude PREP phase events');
    });

    test('9.2 total playback duration is within [40000, 55000] ms for standard match', () => {
      const segs = [createMockSegment(0), createMockSegment(1), createMockSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      assert.ok(
        payload.totalPlaybackDurationMs >= 40000 && payload.totalPlaybackDurationMs <= 55000,
        `Total duration must be in [40000, 55000] ms, got ${payload.totalPlaybackDurationMs}`,
      );
    });

    test('9.3 identifies 1-2 peak windows per round played at 1.0x', () => {
      const segs = [createMockSegment(0), createMockSegment(1), createMockSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      const peaks = payload.speedRanges.filter((r) => r.isPeak);
      assert.ok(peaks.length >= 1 && peaks.length <= 6, `Peak count must be 1..6, got ${peaks.length}`);
      for (const p of peaks) {
        assert.equal(p.speed, 1.0, 'Peak windows must play at 1.0x speed');
      }
    });

    test('9.4 base speed outside peaks is clamped between 2.5x and 3.5x', () => {
      const segs = [createMockSegment(0), createMockSegment(1), createMockSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      const nonPeaks = payload.speedRanges.filter((r) => !r.isPeak);
      assert.ok(nonPeaks.length > 0, 'Must contain non-peak ranges');
      for (const r of nonPeaks) {
        assert.ok(
          r.speed >= 2.5 && r.speed <= 3.5,
          `Base speed must be clamped within [2.5, 3.5], got ${r.speed}`,
        );
      }
    });

    test('9.5 event timeline preserves chronological timestamp ordering', () => {
      const segs = [createMockSegment(0), createMockSegment(1), createMockSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      for (let i = 0; i < payload.events.length - 1; i++) {
        assert.ok(
          payload.events[i].t <= payload.events[i + 1].t,
          `Event at index ${i} (t=${payload.events[i].t}) must occur before or at index ${i + 1} (t=${payload.events[i + 1].t})`,
        );
      }
    });
  });

  // =========================================================================
  // Feature 10: Room Lifecycle & Reconnect
  // Source: ORIGINAL_REQUEST.md §R5, PROJECT.md M1, Feature 40
  // =========================================================================
  describe('Feature 10: Room Lifecycle & Reconnect', () => {
    test('10.1 create room generates a 4-digit room code', async () => {
      const harness = new TestHarness();
      try {
        const host = await harness.createClient('HostPlayer');
        const snap = await host.createRoom('HostPlayer');
        assert.match(snap.roomCode, /^\d{4}$/, 'Room code must be a 4-digit string');
        assert.equal(snap.hostId, host.id);
        assert.equal(snap.players.length, 1);
      } finally {
        await harness.cleanup();
      }
    });

    test('10.2 players can join room up to roster capacity', async () => {
      const harness = new TestHarness();
      try {
        const { roomCode, clients } = await harness.setupLobby({ playerCount: 4 });
        assert.equal(clients.length, 4);
        assert.equal(clients[0].lastSnapshot?.players.length, 4);
      } finally {
        await harness.cleanup();
      }
    });

    test('10.3 reconnect with token recovers player session and identity', async () => {
      const harness = new TestHarness();
      try {
        const host = await harness.createClient('Host');
        const hostSnap = await host.createRoom('Host');
        const p2 = await harness.createClient('Player2');
        await p2.joinRoom(hostSnap.roomCode, 'Player2');

        const originalP2Id = p2.id;
        const originalP2Token = p2.token;

        // Disconnect P2
        await p2.close();

        // Reconnect P2 via fresh socket
        const p2Recon = await harness.createClient('Player2');
        const reconSnap = await p2Recon.reconnect(hostSnap.roomCode, originalP2Token);

        assert.equal(p2Recon.id, originalP2Id, 'Player ID must be preserved upon token reconnect');
        const p2Entry = reconSnap.players.find((p) => p.id === originalP2Id);
        assert.ok(p2Entry?.connected, 'Player entry in room roster must show connected=true');
      } finally {
        await harness.cleanup();
      }
    });

    test('10.4 host disconnect migrates host role to next connected player', async () => {
      const harness = new TestHarness();
      try {
        const host = await harness.createClient('Host');
        const hostSnap = await host.createRoom('Host');
        const p2 = await harness.createClient('Player2');
        await p2.joinRoom(hostSnap.roomCode, 'Player2');

        // Close host connection
        await host.close();

        // P2 should receive STATE_SYNC showing P2 as the new host
        const migrationSnap = await p2.waitForSnapshot((s) => s.hostId === p2.id);
        assert.equal(migrationSnap.hostId, p2.id, 'Host ID must migrate to Player 2');
        const p2Player = migrationSnap.players.find((p) => p.id === p2.id);
        assert.equal(p2Player?.isHost, true, 'Player 2 isHost must be true');
      } finally {
        await harness.cleanup();
      }
    });

    test('10.5 RETURN_TO_LOBBY resets room back to LOBBY and clears game state', async () => {
      const harness = new TestHarness();
      try {
        const { host, players } = await harness.setupLobby({ playerCount: 4 });
        host.send({ type: 'START_GAME' });
        await host.waitForSnapshot((s) => s.screen === 'ROLE_SELECT');

        host.send({ type: 'RETURN_TO_LOBBY' });
        const lobbySnap = await host.waitForSnapshot((s) => s.screen === 'LOBBY');
        assert.equal(lobbySnap.screen, 'LOBBY');
        assert.equal(lobbySnap.segment, null);
        assert.equal(lobbySnap.drawItems.length, 0);
        assert.equal(lobbySnap.sabotageItems.length, 0);
        assert.equal(lobbySnap.ticker.length, 0);
      } finally {
        await harness.cleanup();
      }
    });
  });
});
