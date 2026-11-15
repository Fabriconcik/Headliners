import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TestHarness } from './e2e/harness.js';
import {
  ABILITIES,
  ENERGY,
  FALLBACK_HEADLINES,
  FORCED_BRUSH,
  TIMINGS,
} from '../shared/constants.js';
import type { AbilityId, S2CMessage } from '../shared/protocol.js';

/**
 * Microtask flusher for MockWebSocket message queue.
 */
async function flushAsync(count = 5): Promise<void> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

describe('Empirical Adversarial Stress Suite: Game State Machine & Server Logic (Milestone 2)', () => {
  // =========================================================================
  // Suite 1: Full Phase Transitions (PREP <=30s -> SPLASH 3s -> LIVE 45s -> FREEZE 3s)
  // =========================================================================
  describe('Suite 1: Phase State Machine Transitions & Invariants', () => {
    it('1.1 verifies full phase transitions and exact phase timings across segments', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date', 'setInterval'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 2,
          saboteurs: 1,
        });

        // Advance lobby role-select ready early advance
        t.mock.timers.tick(650);
        await flushAsync();

        // 1. PREP Phase: 30s for human lead writer
        const prepSnap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST' && s.segment?.phase === 'PREP');
        assert.equal(prepSnap.segment?.phase, 'PREP');
        assert.equal(prepSnap.segment?.index, 0);
        assert.equal(prepSnap.segment?.totalSegments, 3);
        assert.equal(prepSnap.segment?.leadWriterId, writers[0].id);
        const prepDuration = prepSnap.segment!.phaseEndsAt - prepSnap.segment!.phaseStartedAt;
        assert.equal(prepDuration, TIMINGS.PREP_MAX_MS, 'PREP duration must be exactly 30,000ms');

        // Early submit headline from lead writer
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'BREAKING: STRESS TEST VERIFIED' });
        await flushAsync();

        // 2. SPLASH Phase: exactly 3,000ms
        const splashSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        assert.equal(splashSnap.segment?.phase, 'SPLASH');
        assert.equal(splashSnap.segment?.headline, 'BREAKING: STRESS TEST VERIFIED');
        const splashDuration = splashSnap.segment!.phaseEndsAt - splashSnap.segment!.phaseStartedAt;
        assert.equal(splashDuration, TIMINGS.SPLASH_MS, 'SPLASH duration must be 3,000ms');

        // Tick 3,000ms for SPLASH
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await flushAsync();

        // 3. LIVE Phase: exactly 45,000ms
        const liveSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
        assert.equal(liveSnap.segment?.phase, 'LIVE');
        const liveDuration = liveSnap.segment!.phaseEndsAt - liveSnap.segment!.phaseStartedAt;
        assert.equal(liveDuration, TIMINGS.LIVE_MS, 'LIVE duration must be 45,000ms');

        // Tick 45,000ms for LIVE
        t.mock.timers.tick(TIMINGS.LIVE_MS);
        await flushAsync();

        // 4. FREEZE Phase: exactly 3,000ms
        const freezeSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
        assert.equal(freezeSnap.segment?.phase, 'FREEZE');
        const freezeDuration = freezeSnap.segment!.phaseEndsAt - freezeSnap.segment!.phaseStartedAt;
        assert.equal(freezeDuration, TIMINGS.FREEZE_MS, 'FREEZE duration must be 3,000ms');

        // Tick 3,000ms for FREEZE -> triggers transition to Segment 2 PREP
        t.mock.timers.tick(TIMINGS.FREEZE_MS);
        await flushAsync();

        const seg2PrepSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'PREP' && s.segment.index === 1);
        assert.equal(seg2PrepSnap.segment?.index, 1);
        assert.equal(seg2PrepSnap.segment?.phase, 'PREP');
      } finally {
        await harness.cleanup();
      }
    });

    it('1.2 strictly locks all artist, writer, and saboteur mutations during non-LIVE phases', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date', 'setInterval'] });
      try {
        const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
          saboteurClass: 'vandal',
        });
        t.mock.timers.tick(650);
        await flushAsync();

        // --- PREP Phase ---
        const prepSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
        assert.equal(prepSnap.segment?.phase, 'PREP');

        // Artist attempts to draw stroke
        artists[0].send({
          type: 'STROKE_START',
          id: 'illegal-prep-stroke',
          color: '#FFFFFF',
          widthNorm: 0.02,
          point: { x: 0.5, y: 0.5 },
        });
        // Artist attempts wipers
        artists[0].send({ type: 'USE_WIPERS' });
        // Saboteur attempts ability
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.5, y: 0.5 });
        // Writer attempts ticker
        writers[0].send({ type: 'ADD_TICKER', text: 'Illegal Ticker' });
        // Saboteur attempts reaction
        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😂' });
        await flushAsync();

        let currentRoom = (harness as any).roomManager.rooms.get(host.roomCode);
        assert.equal(currentRoom.drawItems.length, 0, 'No draw items in PREP');
        assert.equal(currentRoom.sabotageItems.length, 0, 'No sabotage items in PREP');
        assert.equal(currentRoom.ticker.length, 0, 'No ticker items in PREP');

        // Transition to SPLASH
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'TEST' });
        await flushAsync();
        assert.equal(currentRoom.segment?.phase, 'SPLASH');

        // --- SPLASH Phase ---
        artists[0].send({
          type: 'STROKE_START',
          id: 'illegal-splash-stroke',
          color: '#FFFFFF',
          widthNorm: 0.02,
          point: { x: 0.5, y: 0.5 },
        });
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.5, y: 0.5 });
        writers[0].send({ type: 'ADD_TICKER', text: 'Illegal Splash Ticker' });
        await flushAsync();

        assert.equal(currentRoom.drawItems.length, 0, 'No draw items in SPLASH');
        assert.equal(currentRoom.sabotageItems.length, 0, 'No sabotage items in SPLASH');
        assert.equal(currentRoom.ticker.length, 0, 'No ticker items in SPLASH');

        // Advance to LIVE then FREEZE
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await flushAsync();
        assert.equal(currentRoom.segment?.phase, 'LIVE');

        t.mock.timers.tick(TIMINGS.LIVE_MS);
        await flushAsync();
        assert.equal(currentRoom.segment?.phase, 'FREEZE');

        // --- FREEZE Phase ---
        artists[0].send({
          type: 'STROKE_START',
          id: 'illegal-freeze-stroke',
          color: '#FFFFFF',
          widthNorm: 0.02,
          point: { x: 0.5, y: 0.5 },
        });
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.5, y: 0.5 });
        writers[0].send({ type: 'ADD_TICKER', text: 'Illegal Freeze Ticker' });
        await flushAsync();

        assert.equal(currentRoom.drawItems.length, 0, 'No draw items in FREEZE');
        assert.equal(currentRoom.sabotageItems.length, 0, 'No sabotage items in FREEZE');
        assert.equal(currentRoom.ticker.length, 0, 'No ticker items in FREEZE');
      } finally {
        await harness.cleanup();
      }
    });

    it('1.3 verifies segment packaging and excludes PREP from recorded segment timeline', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date', 'setInterval'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
        });
        t.mock.timers.tick(650);
        await flushAsync();

        // Submit headline in PREP
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'RECORD TEST' });
        await flushAsync();

        // SPLASH -> LIVE -> FREEZE
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await flushAsync();

        t.mock.timers.tick(TIMINGS.LIVE_MS);
        await flushAsync();

        t.mock.timers.tick(TIMINGS.FREEZE_MS);
        await flushAsync();

        const room = (harness as any).roomManager.rooms.get(host.roomCode);
        assert.equal(room.recordedSegments.length, 1);
        const recorded = room.recordedSegments[0];
        assert.equal(recorded.headline, 'RECORD TEST');
        assert.equal(
          recorded.sourceDurationMs,
          TIMINGS.SPLASH_MS + TIMINGS.LIVE_MS + TIMINGS.FREEZE_MS,
        );

        // Assert no event in recorded events has type === 'PHASE' and phase === 'PREP'
        const prepEvents = recorded.events.filter(
          (e: any) => e.type === 'PHASE' && e.phase === 'PREP',
        );
        assert.equal(prepEvents.length, 0, 'Recorded segments must strictly exclude PREP phase');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // Suite 2: Early Headline Submit by Lead Writer vs Late Submit After Timeout
  // =========================================================================
  describe('Suite 2: Early vs Late Headline Submission Boundary & Concurrency', () => {
    it('2.1 early submit immediately cancels the 30s timer and enters SPLASH without delay', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date', 'setInterval'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
        });
        t.mock.timers.tick(650);
        await flushAsync();

        // At t = 2,000ms into PREP, lead writer submits early
        t.mock.timers.tick(2000);
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'EARLY EDITION' });
        await flushAsync();

        const splashSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        assert.equal(splashSnap.segment?.headline, 'EARLY EDITION');

        // Advance 3,000ms for SPLASH -> should be in LIVE at t = 5,000ms
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await flushAsync();

        const liveSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
        assert.equal(liveSnap.segment?.phase, 'LIVE');

        // Now advance to t = 30,000ms (when original PREP timer was scheduled)
        // If the 30s timer was NOT cancelled/guarded, it would erroneously overwrite the headline!
        t.mock.timers.tick(TIMINGS.PREP_MAX_MS);
        await flushAsync();

        const currentSnap = host.lastSnapshot!;
        assert.equal(currentSnap.segment?.headline, 'EARLY EDITION', 'Headline must remain EARLY EDITION');
      } finally {
        await harness.cleanup();
      }
    });

    it('2.2 timeout fallback chooses random headline and rejects subsequent late submissions', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date', 'setInterval'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
        });
        t.mock.timers.tick(650);
        await flushAsync();

        // Let full 30s PREP timeout expire without submit
        t.mock.timers.tick(TIMINGS.PREP_MAX_MS);
        await flushAsync();

        const splashSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        const fallbackHeadline = splashSnap.segment?.headline;
        assert.ok(fallbackHeadline && fallbackHeadline.length > 0);
        assert.ok(
          FALLBACK_HEADLINES.includes(fallbackHeadline),
          `Headline "${fallbackHeadline}" must be in FALLBACK_HEADLINES`,
        );

        // Lead writer attempts late submission after timeout
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'TOO LATE NEWS' });
        await flushAsync();

        // Verify headline remains unchanged and did not accept late submission
        const currentRoom = (harness as any).roomManager.rooms.get(host.roomCode);
        assert.equal(currentRoom.segment?.headline, fallbackHeadline);
      } finally {
        await harness.cleanup();
      }
    });

    it('2.3 handles burst flood of 50 concurrent headline submits, accepting only first', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date', 'setInterval'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
        });
        t.mock.timers.tick(650);
        await flushAsync();

        // Lead writer sends 50 duplicate/concurrent submissions in a tight loop
        for (let i = 0; i < 50; i++) {
          writers[0].send({ type: 'SUBMIT_HEADLINE', headline: `FLOOD HEADLINE #${i}` });
        }
        await flushAsync();

        const splashSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        assert.equal(splashSnap.segment?.headline, 'FLOOD HEADLINE #0', 'Only first submission accepted');

        const currentRoom = (harness as any).roomManager.rooms.get(host.roomCode);
        assert.equal(currentRoom.segment?.headline, 'FLOOD HEADLINE #0');
      } finally {
        await harness.cleanup();
      }
    });

    it('2.4 sanitizes whitespace, uppercase conversion, and truncates headlines >90 characters', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date', 'setInterval'] });
      try {
        const { host, writers } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
        });
        t.mock.timers.tick(650);
        await flushAsync();

        const longHeadline = 'a'.repeat(150);
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: `   ${longHeadline}   ` });
        await flushAsync();

        const splashSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        assert.equal(splashSnap.segment?.headline.length, 90, 'Headline must be clamped to 90 chars');
        assert.equal(splashSnap.segment?.headline, 'A'.repeat(90), 'Headline must be uppercase');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // Suite 3: Wipers 7,000ms Cooldown & Selective Clearing
  // =========================================================================
  describe('Suite 3: Wipers 7,000ms Cooldown & Selective Clearing', () => {
    it('3.1 rapid fire 100 wipers calls: only 1 succeeds and clears sabotageItems while preserving drawItems', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date', 'setInterval'] });
      try {
        const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 2,
          saboteurs: 1,
          saboteurClass: 'vandal',
        });
        t.mock.timers.tick(650);
        await flushAsync();

        // Advance to LIVE
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'WIPERS TEST' });
        await flushAsync();
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await flushAsync();

        const room = (harness as any).roomManager.rooms.get(host.roomCode);
        assert.equal(room.segment?.phase, 'LIVE');

        // Populate canvas with 10 artist strokes
        for (let i = 0; i < 10; i++) {
          artists[0].send({
            type: 'STROKE_START',
            id: `stroke-${i}`,
            color: '#FFFFFF',
            widthNorm: 0.02,
            point: { x: i * 0.08, y: 0.5 },
          });
        }
        // Populate canvas with 5 artist stamps
        for (let i = 0; i < 5; i++) {
          artists[1].send({
            type: 'PLACE_STAMP',
            id: `stamp-${i}`,
            stampId: 'star',
            color: '#FFDF00',
            x: 0.2 + i * 0.1,
            y: 0.2,
          });
        }
        // Populate canvas with 8 sabotage items
        for (let i = 0; i < 8; i++) {
          room.sabotageItems.push({
            id: `sab-${i}`,
            type: 'tomato',
            x: 0.5,
            y: 0.5,
            scale: 1.0,
            rotation: 0,
          });
        }
        await flushAsync();

        assert.equal(room.drawItems.length, 15, 'Must have 10 strokes + 5 stamps = 15 drawItems');
        assert.equal(room.sabotageItems.length, 8, 'Must have 8 sabotageItems');

        // Artist 0 spam-calls wipers 100 times in a tight loop
        let wipersBroadcastCount = 0;
        host.rawSocket.on('message', (data: any) => {
          const msg = JSON.parse(data.toString()) as S2CMessage;
          if (msg.type === 'WIPERS_BC') wipersBroadcastCount++;
        });

        for (let i = 0; i < 100; i++) {
          artists[0].send({ type: 'USE_WIPERS' });
        }
        await flushAsync();

        // Exactly ONE wipers invocation succeeded
        assert.equal(wipersBroadcastCount, 1, 'Only 1 wipers broadcast emitted out of 100 rapid calls');

        // Sabotage items must be empty
        assert.equal(room.sabotageItems.length, 0, 'Wipers must clear all sabotage items');

        // Draw items must remain completely intact (15 items)
        assert.equal(room.drawItems.length, 15, 'Wipers must completely preserve artist strokes and stamps');

        // Advance 6,999ms -> cooldown still active
        t.mock.timers.tick(TIMINGS.WIPERS_COOLDOWN_MS - 1);
        await flushAsync();
        artists[0].send({ type: 'USE_WIPERS' });
        await flushAsync();
        assert.equal(wipersBroadcastCount, 1, 'Wipers call at 6,999ms must be rejected');

        // Advance 2ms -> cooldown expired (7,001ms)
        t.mock.timers.tick(2);
        await flushAsync();
        artists[0].send({ type: 'USE_WIPERS' });
        await flushAsync();
        assert.equal(wipersBroadcastCount, 2, 'Wipers call at 7,001ms must succeed');
      } finally {
        await harness.cleanup();
      }
    });

    it('3.2 enforces per-artist independent wipers cooldowns', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date', 'setInterval'] });
      try {
        const { host, writers, artists } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 2,
          saboteurs: 1,
        });
        t.mock.timers.tick(650);
        await flushAsync();

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'INDEPENDENT WIPERS' });
        await flushAsync();
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await flushAsync();

        const room = (harness as any).roomManager.rooms.get(host.roomCode);

        // Artist 0 uses wipers at t = 0
        artists[0].send({ type: 'USE_WIPERS' });
        await flushAsync();
        const artist0Player = room.players.find((p: any) => p.id === artists[0].id);
        const artist1Player = room.players.find((p: any) => p.id === artists[1].id);

        assert.ok(artist0Player.wipersCooldownUntil > Date.now());
        assert.equal(artist1Player.wipersCooldownUntil, 0);

        // At t = 1,000ms, Artist 1 uses wipers -> succeeds independently!
        t.mock.timers.tick(1000);
        artists[1].send({ type: 'USE_WIPERS' });
        await flushAsync();

        assert.ok(artist1Player.wipersCooldownUntil > Date.now());
        assert.ok(artist1Player.wipersCooldownUntil > artist0Player.wipersCooldownUntil);
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // Suite 4: Forced Brush 4,000ms Lockout
  // =========================================================================
  describe('Suite 4: Forced Brush 4,000ms Lockout & Color/Width Overrides', () => {
    it('4.1 overrides artist stroke color and widthNorm during 4,000ms window, restoring normal tools immediately after', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date', 'setInterval'] });
      try {
        const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
          saboteurClasses: ['director'],
        });
        t.mock.timers.tick(650);
        await flushAsync();

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'FORCED BRUSH TEST' });
        await flushAsync();
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await flushAsync();

        const room = (harness as any).roomManager.rooms.get(host.roomCode);
        assert.equal(room.segment?.phase, 'LIVE');

        // 1. Before forced brush: Artist draws normally
        artists[0].send({
          type: 'STROKE_START',
          id: 'normal-stroke-1',
          color: '#3B82F6',
          widthNorm: 0.02,
          point: { x: 0.1, y: 0.1 },
        });
        await flushAsync();
        assert.equal(room.drawItems[0].color, '#3B82F6');
        assert.equal(room.drawItems[0].widthNorm, 0.02);

        // 2. Director casts forced_brush
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'forced_brush' });
        await flushAsync();
        assert.equal(
          room.effects.forcedBrushUntil,
          Date.now() + TIMINGS.FORCED_BRUSH_DURATION_MS,
        );

        // 3. During lockout (t = 2,000ms): Artist draws stroke with #10B981, widthNorm 0.01
        t.mock.timers.tick(2000);
        artists[0].send({
          type: 'STROKE_START',
          id: 'locked-stroke-2',
          color: '#10B981',
          widthNorm: 0.01,
          point: { x: 0.3, y: 0.3 },
        });
        await flushAsync();

        const lockedStroke = room.drawItems.find((d: any) => d.id === 'locked-stroke-2');
        assert.ok(lockedStroke);
        assert.equal(lockedStroke.color, FORCED_BRUSH.color, 'Must override stroke color to #FF10F0');
        assert.equal(lockedStroke.widthNorm, FORCED_BRUSH.widthNorm, 'Must override widthNorm to 0.075');

        // 4. Boundary check: at t = 3,999ms, still locked
        t.mock.timers.tick(TIMINGS.FORCED_BRUSH_DURATION_MS - 2000 - 1);
        artists[0].send({
          type: 'STROKE_START',
          id: 'boundary-stroke-3',
          color: '#F59E0B',
          widthNorm: 0.04,
          point: { x: 0.4, y: 0.4 },
        });
        await flushAsync();
        const boundaryStroke = room.drawItems.find((d: any) => d.id === 'boundary-stroke-3');
        assert.equal(boundaryStroke.color, FORCED_BRUSH.color, 'At 3,999ms stroke must still be forced');

        // 5. Immediately after lockout (t = 4,001ms): Normal tools restored
        t.mock.timers.tick(2);
        artists[0].send({
          type: 'STROKE_START',
          id: 'restored-stroke-4',
          color: '#F59E0B',
          widthNorm: 0.04,
          point: { x: 0.5, y: 0.5 },
        });
        await flushAsync();
        const restoredStroke = room.drawItems.find((d: any) => d.id === 'restored-stroke-4');
        assert.equal(restoredStroke.color, '#F59E0B', 'After 4,000ms original color must be preserved');
        assert.equal(restoredStroke.widthNorm, 0.04, 'After 4,000ms original widthNorm must be preserved');
      } finally {
        await harness.cleanup();
      }
    });

    it('4.2 forced brush also overrides stamp color during lockout without affecting wipers', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date', 'setInterval'] });
      try {
        const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
          saboteurClasses: ['director'],
        });
        t.mock.timers.tick(650);
        await flushAsync();

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'STAMP FORCED BRUSH' });
        await flushAsync();
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await flushAsync();

        const room = (harness as any).roomManager.rooms.get(host.roomCode);

        // Director casts forced brush
        saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'forced_brush' });
        await flushAsync();

        // Artist places stamp with #FFFFFF
        artists[0].send({
          type: 'PLACE_STAMP',
          id: 'forced-stamp-1',
          stampId: 'camera',
          color: '#FFFFFF',
          x: 0.5,
          y: 0.5,
        });
        await flushAsync();

        const forcedStamp = room.drawItems.find((d: any) => d.id === 'forced-stamp-1');
        assert.ok(forcedStamp);
        assert.equal(forcedStamp.color, FORCED_BRUSH.color, 'Stamp color must be overridden to #FF10F0');

        // Artist calls wipers -> does NOT cancel forcedBrush effect
        artists[0].send({ type: 'USE_WIPERS' });
        await flushAsync();
        assert.ok(room.effects.forcedBrushUntil > Date.now(), 'Wipers must not clear forced brush effect');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // Suite 5: Saboteur Energy Accumulation & Exact Ability Deduction
  // =========================================================================
  describe('Suite 5: Saboteur Energy Accumulation & Ability Deductions', () => {
    it('5.1 verifies energy regen (+10/sec, +2 every 200ms) capped at 100, and paused outside LIVE', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date', 'setInterval'] });
      try {
        const { host, writers, saboteurs } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 1,
          saboteurClass: 'vandal',
        });
        t.mock.timers.tick(650);
        await flushAsync();

        const room = (harness as any).roomManager.rooms.get(host.roomCode);
        const saboteurPlayer = room.players.find((p: any) => p.id === saboteurs[0].id);

        // In PREP phase: advance 5 seconds -> energy must NOT regenerate
        t.mock.timers.tick(5000);
        await flushAsync();
        assert.equal(saboteurPlayer.energy, ENERGY.START, 'Energy must not regenerate during PREP');

        // Transition to LIVE
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ENERGY REGEN TEST' });
        await flushAsync();
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await flushAsync();
        assert.equal(room.segment?.phase, 'LIVE');

        // Force energy to 0 for exact measurement
        saboteurPlayer.energy = 0;

        // Step 1: 1,000ms -> should regenerate exactly +10 energy
        t.mock.timers.tick(1000);
        await flushAsync();
        assert.equal(Math.round(saboteurPlayer.energy), 10, 'Must regenerate +10 energy after 1,000ms');

        // Step 2: 4,000ms more (total 5s) -> should be 50 energy
        t.mock.timers.tick(4000);
        await flushAsync();
        assert.equal(Math.round(saboteurPlayer.energy), 50, 'Must regenerate +50 energy after 5,000ms');

        // Step 3: 10,000ms more (total 15s) -> should cap at 100 (ENERGY.MAX)
        t.mock.timers.tick(10000);
        await flushAsync();
        assert.equal(Math.round(saboteurPlayer.energy), 100, 'Must cap at ENERGY.MAX (100)');

        // Step 4: 10,000ms more -> stays capped at 100
        t.mock.timers.tick(10000);
        await flushAsync();
        assert.equal(Math.round(saboteurPlayer.energy), 100, 'Energy cannot exceed 100');
      } finally {
        await harness.cleanup();
      }
    });

    it('5.2 verifies exact ability deduction across classes and rejection on insufficient energy', async (t) => {
      const harness = new TestHarness();
      t.mock.timers.enable({ apis: ['setTimeout', 'Date', 'setInterval'] });
      try {
        // Setup 3 saboteurs (vandal, hacker, director) in testMode
        const { host, writers, saboteurs } = await harness.setupGameWithRoles({
          writers: 1,
          artists: 1,
          saboteurs: 3,
          saboteurClasses: ['vandal', 'hacker', 'director'],
          testMode: true,
        });
        t.mock.timers.tick(650);
        await flushAsync();

        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ABILITY DEDUCTION TEST' });
        await flushAsync();
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await flushAsync();

        const room = (harness as any).roomManager.rooms.get(host.roomCode);
        const vandal = room.players.find((p: any) => p.saboteurClass === 'vandal');
        const hacker = room.players.find((p: any) => p.saboteurClass === 'hacker');
        const director = room.players.find((p: any) => p.saboteurClass === 'director');

        assert.ok(vandal && hacker && director, 'All 3 classes must be present');

        const vandalClient = saboteurs.find((s) => s.id === vandal.id)!;
        const hackerClient = saboteurs.find((s) => s.id === hacker.id)!;
        const directorClient = saboteurs.find((s) => s.id === director.id)!;

        // --- Vandal Test ---
        vandal.energy = 60;
        // Tomato costs 25: 60 - 25 = 35
        vandalClient.send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.5, y: 0.5 });
        await flushAsync();
        assert.equal(Math.round(vandal.energy), 35, 'Tomato cost 25 deducted');

        // Sticker costs 30: 35 - 30 = 5
        vandalClient.send({ type: 'USE_ABILITY', abilityId: 'sticker', x: 0.5, y: 0.5 });
        await flushAsync();
        assert.equal(Math.round(vandal.energy), 5, 'Sticker cost 30 deducted');

        // Insufficient energy check: Tomato (25) attempted with 5 energy -> rejected!
        vandalClient.send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.5, y: 0.5 });
        await flushAsync();
        assert.equal(Math.round(vandal.energy), 5, 'Energy must not drop when insufficient');

        // --- Director Test ---
        director.energy = 100;
        // Forced Brush costs 55: 100 - 55 = 45
        directorClient.send({ type: 'USE_ABILITY', abilityId: 'forced_brush' });
        await flushAsync();
        assert.equal(Math.round(director.energy), 45, 'Forced Brush cost 55 deducted');

        // Censor costs 40: 45 - 40 = 5
        directorClient.send({ type: 'USE_ABILITY', abilityId: 'censor', x: 0.5, y: 0.5 });
        await flushAsync();
        assert.equal(Math.round(director.energy), 5, 'Censor cost 40 deducted');

        // Spotlight costs 45: attempted with 5 energy -> rejected!
        directorClient.send({ type: 'USE_ABILITY', abilityId: 'spotlight', x: 0.5, y: 0.5 });
        await flushAsync();
        assert.equal(Math.round(director.energy), 5, 'Spotlight rejected on insufficient energy');

        // --- Hacker Test ---
        hacker.energy = 100;
        // Glitch costs 50: 100 - 50 = 50
        hackerClient.send({ type: 'USE_ABILITY', abilityId: 'glitch' });
        await flushAsync();
        assert.equal(Math.round(hacker.energy), 50, 'Glitch cost 50 deducted');

        // Ticker hack costs 35: 50 - 35 = 15
        hackerClient.send({ type: 'USE_ABILITY', abilityId: 'ticker_hack' });
        await flushAsync();
        assert.equal(Math.round(hacker.energy), 15, 'Ticker Hack cost 35 deducted');

        // Cross-class rejection: Hacker attempting Vandal's tomato -> rejected!
        hackerClient.send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.5, y: 0.5 });
        await flushAsync();
        assert.equal(Math.round(hacker.energy), 15, 'Cross-class ability strictly rejected');
      } finally {
        await harness.cleanup();
      }
    });
  });
});
