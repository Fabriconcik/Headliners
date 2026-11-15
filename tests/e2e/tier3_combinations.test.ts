import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { TestHarness } from './harness.js';
import {
  ENERGY,
  FALLBACK_HEADLINES,
  FORCED_BRUSH,
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

describe('Tier 3: Cross-Feature Interactions E2E Test Suite', () => {
  // =========================================================================
  // Test 3.1: Wipers vs Personal Undo
  // Source: ORIGINAL_REQUEST.md §R1.3, R4.2; Explorer 2 §4.3 #1
  // Artist 1 draws stroke, Saboteur places tomato, Artist uses wipers ->
  // tomato removed, Artist calls undo -> stroke removed, canvas completely empty.
  // =========================================================================
  test('3.1 Wipers vs Personal Undo clears sabotage and author stroke leaving canvas empty', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 1,
        saboteurs: 1,
        testMode: true,
      });
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'WIPERS UNDO COMBO' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

      // 1. Artist draws a stroke
      artists[0].send({
        type: 'STROKE_START',
        id: 'art-stroke-1',
        color: '#FFFFFF',
        widthNorm: 0.02,
        point: { x: 0.5, y: 0.5 },
      });
      await host.waitFor('STROKE_START_BC');

      artists[0].send({
        type: 'STROKE_POINTS',
        id: 'art-stroke-1',
        points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }],
      });
      await host.waitFor('STROKE_POINTS_BC');

      // 2. Saboteur casts tomato
      saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.3, y: 0.3 });
      await host.waitFor('SABOTAGE_VISUAL_BC');

      const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
      assert.equal(room.drawItems.length, 1, 'Canvas must have 1 artist stroke');
      assert.equal(room.sabotageItems.length, 1, 'Canvas must have 1 sabotage item');

      // 3. Artist uses wipers -> clears sabotage only
      artists[0].send({ type: 'USE_WIPERS' });
      await host.waitFor('WIPERS_BC');

      assert.equal(room.sabotageItems.length, 0, 'Wipers must clear all sabotage items');
      assert.equal(room.drawItems.length, 1, 'Wipers must preserve artist stroke');

      // 4. Artist invokes personal undo -> removes own stroke
      artists[0].send({ type: 'UNDO_LAST' });
      await host.waitFor('UNDO_BC');

      assert.equal(room.drawItems.length, 0, 'Personal undo must remove artist stroke');
      assert.equal(room.sabotageItems.length, 0, 'Sabotage layer remains empty');
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Test 3.2: Multi-Artist Isolation
  // Source: ORIGINAL_REQUEST.md §R1.3, R4.2; Explorer 2 §4.3 #2
  // Artist 1 draws Stroke A, Artist 2 draws Stroke B, Artist 2 calls undo ->
  // Stroke B removed, Stroke A preserved.
  // =========================================================================
  test('3.2 Multi-Artist Isolation: undo removes invoking artist stroke only', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const { host, writers, artists } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 2,
        saboteurs: 1,
      });
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'MULTI ARTIST TEST' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

      // Artist 1 draws stroke A
      artists[0].send({
        type: 'STROKE_START',
        id: 'stroke-artist-1',
        color: '#FF0000',
        widthNorm: 0.02,
        point: { x: 0.2, y: 0.2 },
      });
      await host.waitFor('STROKE_START_BC');
      artists[0].send({
        type: 'STROKE_POINTS',
        id: 'stroke-artist-1',
        points: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.3 }],
      });
      await host.waitFor('STROKE_POINTS_BC');

      // Artist 2 draws stroke B
      artists[1].send({
        type: 'STROKE_START',
        id: 'stroke-artist-2',
        color: '#00FF00',
        widthNorm: 0.04,
        point: { x: 0.7, y: 0.7 },
      });
      await host.waitFor('STROKE_START_BC');
      artists[1].send({
        type: 'STROKE_POINTS',
        id: 'stroke-artist-2',
        points: [{ x: 0.7, y: 0.7 }, { x: 0.8, y: 0.8 }],
      });
      await host.waitFor('STROKE_POINTS_BC');

      const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
      assert.equal(room.drawItems.length, 2, 'Room must contain both strokes');

      // Artist 2 calls undo
      artists[1].send({ type: 'UNDO_LAST' });
      const undoBc = await host.waitFor('UNDO_BC');
      assert.equal(undoBc.itemId, 'stroke-artist-2', 'Undo must target Artist 2 stroke');

      assert.equal(room.drawItems.length, 1, 'Only 1 stroke must remain on canvas');
      assert.equal(room.drawItems[0].id, 'stroke-artist-1', 'Artist 1 stroke must be preserved');
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Test 3.3: Director Forced Brush vs Palette Selection
  // Source: ORIGINAL_REQUEST.md §R1.3, R4.1; Explorer 2 §4.3 #3
  // Director triggers forced_brush -> drawn stroke is forced to #FF10F0 and width 0.075.
  // =========================================================================
  test('3.3 Director Forced Brush overrides artist palette selection and width', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 1,
        saboteurs: 1,
        saboteurClasses: ['director'],
        testMode: true,
      });
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'FORCED BRUSH TEST' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

      // Director casts forced_brush
      saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'forced_brush' });
      const fxBc = await host.waitFor('SABOTAGE_FX_BC');
      assert.equal(fxBc.fx, 'forced_brush');

      // Artist attempts to draw with blue (#3B82F6) and thin width (0.02)
      artists[0].send({
        type: 'STROKE_START',
        id: 'custom-stroke-1',
        color: '#3B82F6',
        widthNorm: 0.02,
        point: { x: 0.4, y: 0.4 },
      });
      const strokeBc = await host.waitFor('STROKE_START_BC');
      assert.equal(
        strokeBc.item.color,
        FORCED_BRUSH.color,
        'Stroke color must be overridden to acid pink (#FF10F0)',
      );
      assert.equal(
        strokeBc.item.widthNorm,
        FORCED_BRUSH.widthNorm,
        'Stroke width must be overridden to 0.075',
      );

      const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
      assert.equal(room.drawItems[0].color, FORCED_BRUSH.color);
      assert.equal(room.drawItems[0].widthNorm, FORCED_BRUSH.widthNorm);
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Test 3.4: Director Forced Brush Expiration
  // Source: ORIGINAL_REQUEST.md §R1.3, R4.1; Explorer 2 §4.3 #4
  // 4s expires -> original palette and width restored.
  // =========================================================================
  test('3.4 Director Forced Brush expiration restores normal palette and brush width', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 1,
        saboteurs: 1,
        saboteurClasses: ['director'],
        testMode: true,
      });
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'EXPIRATION TEST' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

      // Director casts forced_brush
      saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'forced_brush' });
      await host.waitFor('SABOTAGE_FX_BC');

      // Fast-forward past 4000ms duration
      t.mock.timers.tick(TIMINGS.FORCED_BRUSH_DURATION_MS + 50);

      // Artist draws with green (#22C55E) and width 0.03
      artists[0].send({
        type: 'STROKE_START',
        id: 'restored-stroke-1',
        color: '#22C55E',
        widthNorm: 0.03,
        point: { x: 0.5, y: 0.5 },
      });
      const strokeBc = await host.waitFor('STROKE_START_BC');
      assert.equal(strokeBc.item.color, '#22C55E', 'Color must not be overridden after expiration');
      assert.equal(strokeBc.item.widthNorm, 0.03, 'Width must not be overridden after expiration');
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Test 3.5: Wipers vs Forced Brush Timer
  // Source: ORIGINAL_REQUEST.md §R1.3, R4.1; Explorer 2 §4.3 #5
  // Wipers clears visual sabotage items, but forced brush effect timer persists.
  // =========================================================================
  test('3.5 Wipers clears visual items but forced brush effect timer persists', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 1,
        saboteurs: 1,
        saboteurClasses: ['director'],
        testMode: true,
      });
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'WIPERS VS FORCED BRUSH' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

      // Grant saboteur sufficient energy for both censor (40) and forced_brush (55)
      const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
      const sabPlayer = room.players.find((p: any) => p.id === saboteurs[0].id);
      sabPlayer.energy = 100;

      // Saboteur casts censor (visual) and forced_brush (FX)
      saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'censor', x: 0.5, y: 0.5 });
      await host.waitFor('SABOTAGE_VISUAL_BC');
      saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'forced_brush' });
      await host.waitFor('SABOTAGE_FX_BC');

      assert.equal(room.sabotageItems.length, 1);

      // Artist invokes wipers
      artists[0].send({ type: 'USE_WIPERS' });
      await host.waitFor('WIPERS_BC');

      // Visual items cleared
      assert.equal(room.sabotageItems.length, 0, 'Visual censor item cleared by wipers');

      // Advance 500ms (forced brush duration is 4000ms, still active)
      t.mock.timers.tick(500);

      // Artist draws stroke during forced brush window
      artists[0].send({
        type: 'STROKE_START',
        id: 'persisting-stroke',
        color: '#3B82F6',
        widthNorm: 0.02,
        point: { x: 0.2, y: 0.2 },
      });
      const strokeBc = await host.waitFor('STROKE_START_BC');
      assert.equal(
        strokeBc.item.color,
        FORCED_BRUSH.color,
        'Forced brush effect must persist despite wipers clearing visual items',
      );
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Test 3.6: Hacker Ticker Hack vs Active Ticker
  // Source: ORIGINAL_REQUEST.md §R1.3, R3.2; Explorer 2 §4.3 #6
  // Writer submits ticker text, Hacker casts ticker_hack -> scrambled ticker broadcast after 3s.
  // =========================================================================
  test('3.6 Hacker Ticker Hack scrambles active ticker message after 3s delay', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const { host, writers, saboteurs } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 1,
        saboteurs: 1,
        saboteurClasses: ['hacker'],
        testMode: true,
      });
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'TICKER HACK ACTIVE' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

      const originalText = 'Срочный выпуск новостей из мэрии';
      writers[0].send({ type: 'ADD_TICKER', text: originalText });
      const tickerBc = await host.waitFor('TICKER_ADD_BC');
      assert.equal(tickerBc.message.text, originalText);

      // Hacker casts ticker_hack
      saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'ticker_hack' });
      await flushAsync();

      // Before delay, ticker is not yet scrambled
      t.mock.timers.tick(1000);
      const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
      assert.equal(room.ticker[0].hackedText, undefined);

      // Advance remaining delay to 3000ms
      t.mock.timers.tick(TIMINGS.HACKER_TICKER_DELAY_MS - 1000);
      const hackBc = await host.waitFor('TICKER_HACK_BC');
      assert.equal(hackBc.id, tickerBc.message.id);
      assert.notEqual(hackBc.hackedText, originalText, 'Ticker text must be scrambled');
      assert.equal(room.ticker[0].hackedText, hackBc.hackedText);
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Test 3.7: Hacker Ticker Hack Pre-Armed
  // Source: ORIGINAL_REQUEST.md §R1.3, R3.2; Explorer 2 §4.3 #7
  // Hacker casts ticker_hack before ticker exists -> auto-scrambles next incoming ticker.
  // =========================================================================
  test('3.7 Hacker Ticker Hack pre-armed before ticker arrives automatically scrambles it', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const { host, writers, saboteurs } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 1,
        saboteurs: 1,
        saboteurClasses: ['hacker'],
        testMode: true,
      });
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'PRE ARMED TEST' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

      // Hacker casts ticker_hack with empty ticker list
      saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'ticker_hack' });
      await flushAsync();

      const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
      assert.equal(
        room.segment.pendingTickerHacks,
        1,
        'Pending ticker hacks counter must be incremented',
      );

      // Writer submits ticker
      const incomingText = 'Будущие экстренные новости';
      writers[0].send({ type: 'ADD_TICKER', text: incomingText });
      const tickerBc = await host.waitFor('TICKER_ADD_BC');
      assert.equal(tickerBc.message.text, incomingText);

      // Fast forward 3000ms delay
      t.mock.timers.tick(TIMINGS.HACKER_TICKER_DELAY_MS);
      const hackBc = await host.waitFor('TICKER_HACK_BC');
      assert.equal(hackBc.id, tickerBc.message.id);
      assert.notEqual(hackBc.hackedText, incomingText, 'Pre-armed hack must scramble incoming message');
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Test 3.8: Double Ticker Hack Isolation
  // Source: ORIGINAL_REQUEST.md §R1.3, R3.2; Explorer 2 §4.3 #8
  // Hacker casts ticker_hack twice -> only unhacked messages scrambled.
  // =========================================================================
  test('3.8 Double Ticker Hack targets unhacked messages without corrupting already hacked text', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    try {
      const { host, writers, saboteurs } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 1,
        saboteurs: 1,
        saboteurClasses: ['hacker'],
        testMode: true,
      });
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'DOUBLE HACK TEST' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

      // Message 1
      writers[0].send({ type: 'ADD_TICKER', text: 'Строка 1 оригинальная' });
      const t1 = await host.waitFor('TICKER_ADD_BC');

      // Hack 1
      saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'ticker_hack' });
      await flushAsync();
      t.mock.timers.tick(TIMINGS.HACKER_TICKER_DELAY_MS);
      const hackBc1 = await host.waitFor('TICKER_HACK_BC');
      assert.equal(hackBc1.id, t1.message.id);
      const savedHack1 = hackBc1.hackedText;

      // Energy regeneration tick (4s * 10 = +40 energy, sufficient for second hack)
      t.mock.timers.tick(4000);

      // Message 2
      writers[0].send({ type: 'ADD_TICKER', text: 'Строка 2 оригинальная' });
      const t2 = await host.waitFor('TICKER_ADD_BC');

      // Hack 2
      saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'ticker_hack' });
      await flushAsync();
      t.mock.timers.tick(TIMINGS.HACKER_TICKER_DELAY_MS);
      const hackBc2 = await host.waitFor('TICKER_HACK_BC');
      assert.equal(hackBc2.id, t2.message.id, 'Second hack must target message 2');

      const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
      assert.equal(room.ticker[0].hackedText, savedHack1, 'Message 1 hackedText must remain untouched');
      assert.notEqual(room.ticker[1].hackedText, 'Строка 2 оригинальная');
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Test 3.9: Lead Writer Headline into Replay
  // Source: ORIGINAL_REQUEST.md §R1.1, R2.1; Explorer 2 §4.3 #9
  // Custom headline submitted in PREP appears uppercase in Replay SEGMENT_START.
  // =========================================================================
  test('3.9 Lead Writer Headline in PREP appears verbatim in Replay SEGMENT_START', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const { host, writers } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 2,
        saboteurs: 1,
      });
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

      const customHeadline = 'УЧЕНЫЕ ОБНАРУЖИЛИ ГОВОРЯЩИХ КОТОВ В ЦЕНТРЕ ГОРОДА';
      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: customHeadline });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
      t.mock.timers.tick(TIMINGS.LIVE_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
      t.mock.timers.tick(TIMINGS.FREEZE_MS);

      // Segment 2
      await host.waitForSnapshot((s) => s.segment?.index === 1 && s.segment?.phase === 'PREP');
      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ВТОРОЙ ВЫПУСК НОВОСТЕЙ' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
      t.mock.timers.tick(TIMINGS.LIVE_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
      t.mock.timers.tick(TIMINGS.FREEZE_MS);

      // Segment 3
      await host.waitForSnapshot((s) => s.segment?.index === 2 && s.segment?.phase === 'PREP');
      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ТРЕТИЙ ФИНАЛЬНЫЙ ВЫПУСК' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
      t.mock.timers.tick(TIMINGS.LIVE_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
      t.mock.timers.tick(TIMINGS.FREEZE_MS);

      // Replay screen reached
      const replaySnap = await host.waitForSnapshot((s) => s.screen === 'REPLAY');
      assert.ok(replaySnap.replay, 'Replay payload must be present');
      const startEv = replaySnap.replay.events.find(
        (e) => e.type === 'SEGMENT_START' && (e as any).segmentIndex === 0,
      );
      assert.ok(startEv, 'Segment 0 start event must exist in replay');
      assert.equal((startEv as any).headline, customHeadline);
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Test 3.10: Fallback Headline into Replay
  // Source: ORIGINAL_REQUEST.md §R1.1, R2.1; Explorer 2 §4.3 #10
  // PREP timeout fallback headline appears in Replay.
  // =========================================================================
  test('3.10 PREP timeout fallback headline appears in Replay events', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const { host, writers } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 2,
        saboteurs: 1,
      });
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

      // Do NOT submit headline -> wait for 30s timeout
      t.mock.timers.tick(TIMINGS.PREP_MAX_MS);
      const splashSnap = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      const assignedFallback = splashSnap.segment?.headline;
      assert.ok(
        FALLBACK_HEADLINES.includes(assignedFallback as any),
        `Assigned headline "${assignedFallback}" must be in FALLBACK_HEADLINES`,
      );

      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
      t.mock.timers.tick(TIMINGS.LIVE_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
      t.mock.timers.tick(TIMINGS.FREEZE_MS);

      // Complete segments 1 and 2
      for (let i = 1; i < 3; i++) {
        await host.waitForSnapshot((s) => s.segment?.index === i && s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: `ROUND ${i} HEADLINE` });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
        t.mock.timers.tick(TIMINGS.LIVE_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
        t.mock.timers.tick(TIMINGS.FREEZE_MS);
      }

      const replaySnap = await host.waitForSnapshot((s) => s.screen === 'REPLAY');
      const seg0 = replaySnap.replay?.events.find(
        (e) => e.type === 'SEGMENT_START' && (e as any).segmentIndex === 0,
      );
      assert.equal((seg0 as any).headline, assignedFallback);
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Test 3.11: Saboteur Energy Across Segment Boundary
  // Source: ORIGINAL_REQUEST.md §R1.3, R3.1; Explorer 2 §4.3 #11
  // Energy frozen in FREEZE/PREP, resets to >=60 in LIVE 2 and resumes regen.
  // =========================================================================
  test('3.11 Saboteur energy freezes outside LIVE and resets to >=60 upon entering next LIVE', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    try {
      const { host, writers, saboteurs } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 2,
        saboteurs: 1,
      });
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ENERGY BOUNDARY TEST' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

      // Fast-forward 44 seconds into LIVE
      t.mock.timers.tick(TIMINGS.LIVE_MS - 1000);

      // Spend energy down right before FREEZE (three tomatoes: 25 * 3 = 75 cost, leaves 25 from 100)
      saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.1, y: 0.1 });
      await host.waitFor('SABOTAGE_VISUAL_BC');
      saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.2, y: 0.2 });
      await host.waitFor('SABOTAGE_VISUAL_BC');
      saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.3, y: 0.3 });
      await host.waitFor('SABOTAGE_VISUAL_BC');

      const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
      const sabPlayer = room.players.find((p: any) => p.id === saboteurs[0].id);
      assert.ok(sabPlayer.energy <= 30, `Energy should be low, got ${sabPlayer.energy}`);

      // Tick last 1000ms of LIVE to reach FREEZE
      t.mock.timers.tick(1000);
      await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
      const freezeStartEnergy = sabPlayer.energy;
      assert.ok(freezeStartEnergy <= 40, `Energy entering FREEZE must be low, got ${freezeStartEnergy}`);

      // In FREEZE, regen is paused (3000ms passes with zero regen)
      t.mock.timers.tick(TIMINGS.FREEZE_MS);
      assert.equal(
        sabPlayer.energy,
        freezeStartEnergy,
        `Energy must not regenerate during FREEZE, expected ${freezeStartEnergy} got ${sabPlayer.energy}`,
      );

      // In PREP, lead submits headline
      await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');
      assert.equal(
        sabPlayer.energy,
        freezeStartEnergy,
        `Energy must not regenerate during PREP, expected ${freezeStartEnergy} got ${sabPlayer.energy}`,
      );
      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ROUND 2 LIVE' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');

      // Splash passes, entering LIVE 2
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot(
        (s) => s.segment?.index === 1 && s.segment?.phase === 'LIVE',
      );

      assert.ok(
        sabPlayer.energy >= ENERGY.START,
        `Energy must reset to at least ${ENERGY.START} on entering LIVE, got ${sabPlayer.energy}`,
      );

      // Verify regeneration resumes in LIVE 2 (+10/sec)
      t.mock.timers.tick(2000);
      assert.ok(
        sabPlayer.energy >= 78,
        `Energy must actively regenerate during LIVE 2, got ${sabPlayer.energy}`,
      );
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Test 3.12: Emoji Reaction Burst into Replay Peak
  // Source: ORIGINAL_REQUEST.md §R2.2, R3.3; Explorer 2 §4.3 #12
  // Burst of reactions in LIVE creates a 3.5s peak window at 1.0x.
  // =========================================================================
  test('3.12 Emoji reaction burst in LIVE creates a 3.5s peak window at 1.0x in Replay', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const { host, writers, saboteurs } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 2,
        saboteurs: 1,
      });
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'BURST REACTION TEST' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

      // Send 5 reactions spaced by 260ms (>250ms cooldown)
      for (let i = 0; i < 5; i++) {
        saboteurs[0].send({ type: 'SEND_REACTION', emoji: '😂' });
        await host.waitFor('REACTION_BC');
        t.mock.timers.tick(260);
      }

      // Finish segment 1
      t.mock.timers.tick(TIMINGS.LIVE_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
      t.mock.timers.tick(TIMINGS.FREEZE_MS);

      // Finish segments 2 and 3
      for (let i = 1; i < 3; i++) {
        await host.waitForSnapshot((s) => s.segment?.index === i && s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: `FILLER ${i}` });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
        t.mock.timers.tick(TIMINGS.LIVE_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
        t.mock.timers.tick(TIMINGS.FREEZE_MS);
      }

      const replaySnap = await host.waitForSnapshot((s) => s.screen === 'REPLAY');
      assert.ok(replaySnap.replay, 'Replay payload must exist');

      const peaks = replaySnap.replay.speedRanges.filter((r) => r.isPeak);
      assert.ok(peaks.length >= 1, 'Replay must identify at least 1 peak window');
      assert.equal(peaks[0].speed, 1.0, 'Peak window speed must be 1.0x');
      assert.equal(
        peaks[0].endMs - peaks[0].startMs,
        3500,
        'Peak window duration must be exactly 3,500ms',
      );
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Test 3.13: Artist Stamps & Director Censor Banner
  // Source: ORIGINAL_REQUEST.md §R1.3, R4.1; Explorer 2 §4.3 #13
  // Wipers clears censor banner, stamp preserved.
  // =========================================================================
  test('3.13 Wipers clears Director censor banner while preserving Artist stamp', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 1,
        saboteurs: 1,
        saboteurClasses: ['director'],
        testMode: true,
      });
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'STAMP CENSOR TEST' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

      // Artist places a stamp
      artists[0].send({
        type: 'PLACE_STAMP',
        id: 'stamp-1',
        stampId: 'star',
        color: '#EAB308',
        x: 0.5,
        y: 0.5,
      });
      await host.waitFor('STAMP_ADD_BC');

      // Director casts censor banner
      saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'censor', x: 0.5, y: 0.5 });
      await host.waitFor('SABOTAGE_VISUAL_BC');

      const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
      assert.equal(room.drawItems.length, 1, 'Draw items has stamp');
      assert.equal(room.sabotageItems.length, 1, 'Sabotage items has censor');

      // Artist triggers wipers
      artists[0].send({ type: 'USE_WIPERS' });
      await host.waitFor('WIPERS_BC');

      assert.equal(room.sabotageItems.length, 0, 'Censor banner must be removed by wipers');
      assert.equal(room.drawItems.length, 1, 'Artist stamp must be preserved');
      assert.equal(room.drawItems[0].kind, 'stamp');
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Test 3.14: Role Slot Exclusivity & Fast-Advance
  // Source: ORIGINAL_REQUEST.md §R5, AC; Explorer 2 §4.3 #14
  // All players select valid roles/classes -> room fast-advances to BROADCAST in 650ms.
  // =========================================================================
  test('3.14 Role Slot Exclusivity rejects overflow and fast-advances in 650ms when ready', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const { host, players } = await harness.setupLobby({ playerCount: 4 });
      host.send({ type: 'START_GAME' });
      await host.waitForSnapshot((s) => s.screen === 'ROLE_SELECT');

      // 4-player capacity: 1 writer, 2 artists, 1 saboteur
      host.send({ type: 'SELECT_ROLE', role: 'writer' });
      await host.waitForSnapshot((s) => s.players.find((p) => p.id === host.id)?.role === 'writer');

      players[0].send({ type: 'SELECT_ROLE', role: 'artist' });
      await host.waitForSnapshot((s) => s.players.find((p) => p.id === players[0].id)?.role === 'artist');

      // Player 1 attempts to select writer (already 1/1 full) -> must fail
      players[1].send({ type: 'SELECT_ROLE', role: 'writer' });
      const err = await players[1].waitFor('ERROR');
      assert.match(err.message, /Слоты на эту роль уже заняты/);

      // Player 1 selects artist (now 2/2)
      players[1].send({ type: 'SELECT_ROLE', role: 'artist' });
      await host.waitForSnapshot((s) => s.players.find((p) => p.id === players[1].id)?.role === 'artist');

      // Player 2 selects saboteur + class
      players[2].send({ type: 'SELECT_ROLE', role: 'saboteur' });
      players[2].send({ type: 'SELECT_SABOTEUR_CLASS', saboteurClass: 'vandal' });
      await host.waitForSnapshot(
        (s) => s.players.find((p) => p.id === players[2].id)?.saboteurClass === 'vandal',
      );

      // All players are ready! Timer of 650ms is scheduled.
      t.mock.timers.tick(300);
      assert.equal(host.lastSnapshot!.screen, 'ROLE_SELECT', 'Still in ROLE_SELECT at 300ms');

      // At 650ms, fast-advance begins broadcast immediately (well before 15s timeout)
      t.mock.timers.tick(350);
      const broadcastSnap = await host.waitForSnapshot((s) => s.screen === 'BROADCAST');
      assert.equal(broadcastSnap.screen, 'BROADCAST');
      assert.equal(broadcastSnap.segment?.phase, 'PREP');
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Test 3.15: Host Migration Across Phase Boundaries
  // Source: ORIGINAL_REQUEST.md §R5; Explorer 2 §4.3 #15
  // Host disconnects during SPLASH -> new host promoted, segment transitions to LIVE without stalling.
  // =========================================================================
  test('3.15 Host Migration in SPLASH promotes next player and phase transitions smoothly to LIVE', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const { host, writers, artists } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 2,
        saboteurs: 1,
      });
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.segment?.phase === 'PREP');

      // Lead writer submits headline -> transitions to SPLASH
      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'HOST MIGRATION HEADLINE' });
      await artists[0].waitForSnapshot((s) => s.segment?.phase === 'SPLASH');

      // Host disconnects during SPLASH
      await host.close();

      // Artist 0 becomes new host
      const migratedSnap = await artists[0].waitForSnapshot(
        (s) => s.players.find((p) => p.id === artists[0].id)?.isHost === true,
      );
      const artistPlayer = migratedSnap.players.find((p) => p.id === artists[0].id);
      assert.equal(artistPlayer?.isHost, true, 'Artist 0 must be promoted to host');

      // Fast forward SPLASH timer (3000ms)
      t.mock.timers.tick(TIMINGS.SPLASH_MS);

      // Phase machine must advance to LIVE without stalling
      const liveSnap = await artists[0].waitForSnapshot((s) => s.segment?.phase === 'LIVE');
      assert.equal(liveSnap.segment?.phase, 'LIVE', 'State machine must transition to LIVE');
    } finally {
      await harness.cleanup();
    }
  });
});
