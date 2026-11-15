import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { TestHarness } from './harness.js';
import {
  FALLBACK_HEADLINES,
  FORCED_BRUSH,
  QUICK_REACTIONS,
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

describe('Tier 4: Real-World Multiplayer Match Scenarios E2E Test Suite', () => {
  // =========================================================================
  // Scenario 4.1: Standard 4-Player Match (Minimum Roster, 3 Segments)
  // Source: ORIGINAL_REQUEST.md §R1, R2, R4; Explorer 3 §3.1
  // Minimum roster (4 players: Host = Writer, 2 Artists, 1 Vandal Saboteur).
  // 3 segments: Prep -> Splash -> Live -> Freeze -> Replay -> Return to Lobby.
  // =========================================================================
  test('Scenario 4.1: Standard 4-Player Match (Minimum roster, 3 segments, replay & return to lobby)', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    try {
      const { host, writers, artists, saboteurs, allClients } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 2,
        saboteurs: 1,
        saboteurClasses: ['vandal'],
      });

      // Fast-advance to BROADCAST
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.screen === 'BROADCAST');

      const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
      assert.equal(room.writerQueue.length, 3, 'Standard match must have 3 segments');

      // -----------------------------------------------------------------------
      // SEGMENT 1 (Lead: Writer 0)
      // -----------------------------------------------------------------------
      await host.waitForSnapshot((s) => s.segment?.index === 0 && s.segment?.phase === 'PREP');
      const headline1 = 'МЭРИЯ ЗАТОПЛЕНА ГРЕЧНЕВОЙ КАШЕЙ';
      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: headline1 });
      const splash1 = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      assert.equal(splash1.segment?.headline, headline1);

      // Splash passes -> LIVE
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

      // Artist 1 draws 2 strokes
      artists[0].send({
        type: 'STROKE_START',
        id: 's41-stroke-1',
        color: '#3B82F6',
        widthNorm: 0.02,
        point: { x: 0.2, y: 0.3 },
      });
      await host.waitFor('STROKE_START_BC');
      artists[0].send({
        type: 'STROKE_POINTS',
        id: 's41-stroke-1',
        points: [{ x: 0.2, y: 0.3 }, { x: 0.25, y: 0.35 }],
      });
      await host.waitFor('STROKE_POINTS_BC');

      artists[0].send({
        type: 'STROKE_START',
        id: 's41-stroke-2',
        color: '#EF4444',
        widthNorm: 0.025,
        point: { x: 0.4, y: 0.4 },
      });
      await host.waitFor('STROKE_START_BC');

      // Artist 2 places a stamp
      artists[1].send({
        type: 'PLACE_STAMP',
        id: 's41-stamp-1',
        stampId: 'star',
        color: '#F59E0B',
        x: 0.8,
        y: 0.8,
      });
      await host.waitFor('STAMP_ADD_BC');
      assert.equal(room.drawItems.length, 3, 'Canvas has 2 strokes and 1 stamp');

      // Artist 2 calls personal undo -> removes own stamp only
      artists[1].send({ type: 'UNDO_LAST' });
      const undoBc = await host.waitFor('UNDO_BC');
      assert.equal(undoBc.itemId, 's41-stamp-1');
      assert.equal(room.drawItems.length, 2, 'Artist 1 strokes preserved');

      // Saboteur casts tomato
      saboteurs[0].send({ type: 'USE_ABILITY', abilityId: 'tomato', x: 0.5, y: 0.5 });
      await host.waitFor('SABOTAGE_VISUAL_BC');
      assert.equal(room.sabotageItems.length, 1);

      // Artist 1 calls wipers -> clears tomato, preserves strokes
      artists[0].send({ type: 'USE_WIPERS' });
      await host.waitFor('WIPERS_BC');
      assert.equal(room.sabotageItems.length, 0, 'Tomato cleared by wipers');
      assert.equal(room.drawItems.length, 2, 'Strokes remain intact');

      // Advance through remainder of LIVE (45s total)
      t.mock.timers.tick(TIMINGS.LIVE_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');

      // FREEZE (3s) -> Seg 1 recorded
      t.mock.timers.tick(TIMINGS.FREEZE_MS);

      // -----------------------------------------------------------------------
      // SEGMENT 2 & 3
      // -----------------------------------------------------------------------
      for (let segIdx = 1; segIdx < 3; segIdx++) {
        await host.waitForSnapshot((s) => s.segment?.index === segIdx && s.segment?.phase === 'PREP');
        writers[0].send({ type: 'SUBMIT_HEADLINE', headline: `ВЫПУСК ${segIdx + 1} СРОЧНО В НОМЕР` });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Saboteur sends quick reactions
        for (const emoji of QUICK_REACTIONS) {
          saboteurs[0].send({ type: 'SEND_REACTION', emoji });
          await host.waitFor('REACTION_BC');
          t.mock.timers.tick(260);
        }

        t.mock.timers.tick(TIMINGS.LIVE_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
        t.mock.timers.tick(TIMINGS.FREEZE_MS);
      }

      // -----------------------------------------------------------------------
      // REPLAY & RETURN TO LOBBY
      // -----------------------------------------------------------------------
      const replaySnap = await host.waitForSnapshot((s) => s.screen === 'REPLAY');
      assert.ok(replaySnap.replay, 'Replay payload must exist');

      // Verify all 4 clients received REPLAY
      for (const client of allClients) {
        assert.equal(client.lastSnapshot?.screen, 'REPLAY');
      }

      const replay = replaySnap.replay;
      // 1. Replay events must exclude PREP
      const hasPrepEvent = replay.events.some((e) => e.type === 'PHASE' && (e as any).phase === 'PREP');
      assert.equal(hasPrepEvent, false, 'Replay timeline must not include PREP events');

      // 2. Total duration strictly within [40000, 55000] ms
      assert.ok(
        replay.totalPlaybackDurationMs >= 40000 && replay.totalPlaybackDurationMs <= 55000,
        `Total duration must be in [40000, 55000] ms, got ${replay.totalPlaybackDurationMs}`,
      );

      // 3. Peak windows at 1.0x
      const peaks = replay.speedRanges.filter((r) => r.isPeak);
      assert.ok(peaks.length >= 1, 'Replay must identify at least 1 peak window');
      for (const p of peaks) {
        assert.equal(p.speed, 1.0, 'Peak windows must play at 1.0x speed');
      }

      // 4. Base speed within [2.5, 3.5]
      const nonPeaks = replay.speedRanges.filter((r) => !r.isPeak);
      assert.ok(nonPeaks.length > 0, 'Replay must have non-peak base speed ranges');
      for (const r of nonPeaks) {
        assert.ok(
          r.speed >= 2.5 && r.speed <= 3.5,
          `Base speed must be in [2.5, 3.5], got ${r.speed}`,
        );
      }

      // Host skips replay to return to lobby
      host.send({ type: 'SKIP_REPLAY' });
      const lobbySnap = await host.waitForSnapshot((s) => s.screen === 'LOBBY');
      assert.equal(lobbySnap.screen, 'LOBBY');
      assert.equal(lobbySnap.replay, null);
      assert.equal(lobbySnap.drawItems.length, 0);
      assert.equal(lobbySnap.sabotageItems.length, 0);
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Scenario 4.2: Maximum 10-Player Chaos Match
  // Source: ORIGINAL_REQUEST.md §R1, R3, R4; Explorer 3 §3.2
  // 10 players: 3 Writers, 4 Artists, 3 Saboteurs (Vandal, Hacker, Director).
  // All saboteur abilities exercised, rotating leads, interleaved strokes, replay.
  // =========================================================================
  test('Scenario 4.2: Maximum 10-Player Chaos Match (3 writers, 4 artists, 3 saboteurs, full abilities)', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    try {
      const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
        writers: 3,
        artists: 4,
        saboteurs: 3,
        saboteurClasses: ['vandal', 'hacker', 'director'],
      });
      const vandal = saboteurs[0];
      const hacker = saboteurs[1];
      const director = saboteurs[2];

      // Fast-advance 650ms to BROADCAST
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.screen === 'BROADCAST');

      const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
      assert.equal(room.writerQueue.length, 3, '3 writers produce 3 segments');

      // -----------------------------------------------------------------------
      // ROUND 1: Lead Writer 0 + Hacker & Director abilities
      // -----------------------------------------------------------------------
      await host.waitForSnapshot((s) => s.segment?.index === 0 && s.segment?.phase === 'PREP');
      assert.equal(host.lastSnapshot!.segment?.leadWriterId, writers[0].id, 'Writer 0 leads Round 1');

      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'ХАОС 10 ИГРОКОВ: СРОЧНЫЙ ВЫПУСК 1' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

      // Writer submits ticker news
      writers[1].send({ type: 'ADD_TICKER', text: 'Срочное включение: в городе паника!' });
      const tickBc = await host.waitFor('TICKER_ADD_BC');

      // Hacker casts ticker_hack
      hacker.send({ type: 'USE_ABILITY', abilityId: 'ticker_hack' });
      await flushAsync();
      t.mock.timers.tick(TIMINGS.HACKER_TICKER_DELAY_MS);
      const hackBc = await host.waitFor('TICKER_HACK_BC');
      assert.equal(hackBc.id, tickBc.message.id);
      assert.notEqual(hackBc.hackedText, 'Срочное включение: в городе паника!');

      // Director casts forced_brush
      director.send({ type: 'USE_ABILITY', abilityId: 'forced_brush' });
      await host.waitFor('SABOTAGE_FX_BC', (m) => m.fx === 'forced_brush');

      // Artists 0 & 1 draw during forced brush -> overridden to pink #FF10F0
      artists[0].send({
        type: 'STROKE_START',
        id: 's42-forced-1',
        color: '#FFFFFF',
        widthNorm: 0.02,
        point: { x: 0.1, y: 0.1 },
      });
      const strokeBc1 = await host.waitFor('STROKE_START_BC', (m) => m.item.id === 's42-forced-1');
      assert.equal(strokeBc1.item.color, FORCED_BRUSH.color);

      // Director casts censor
      const dirPlayer = room.players.find((p: any) => p.id === director.id);
      dirPlayer.energy = 100;
      director.send({ type: 'USE_ABILITY', abilityId: 'censor', x: 0.5, y: 0.5 });
      await host.waitFor('SABOTAGE_VISUAL_BC', (m) => m.item.type === 'censor');

      // Advance through remainder of LIVE 1
      t.mock.timers.tick(TIMINGS.LIVE_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
      t.mock.timers.tick(TIMINGS.FREEZE_MS);

      // -----------------------------------------------------------------------
      // ROUND 2: Lead Writer 1 + Hacker Glitch & Flip + Vandal Stickers
      // -----------------------------------------------------------------------
      await host.waitForSnapshot((s) => s.segment?.index === 1 && s.segment?.phase === 'PREP');
      assert.equal(host.lastSnapshot!.segment?.leadWriterId, writers[1].id, 'Writer 1 leads Round 2');

      writers[1].send({ type: 'SUBMIT_HEADLINE', headline: 'ВТОРОЙ РАУНД: ХАКЕРЫ АТАКУЮТ ЭФИР' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

      // Hacker casts glitch (cost 50)
      hacker.send({ type: 'USE_ABILITY', abilityId: 'glitch' });
      await host.waitFor('SABOTAGE_FX_BC', (m) => m.fx === 'glitch');

      // Vandal casts sticker
      vandal.send({ type: 'USE_ABILITY', abilityId: 'sticker', x: 0.3, y: 0.7 });
      await host.waitFor('SABOTAGE_VISUAL_BC', (m) => m.item.type === 'sticker');

      // Interleaved drawings from Artists 2 & 3
      artists[2].send({
        type: 'STROKE_START',
        id: 's42-a2-stroke',
        color: '#22C55E',
        widthNorm: 0.03,
        point: { x: 0.6, y: 0.6 },
      });
      await host.waitFor('STROKE_START_BC', (m) => m.item.id === 's42-a2-stroke');

      artists[3].send({
        type: 'PLACE_STAMP',
        id: 's42-a3-stamp',
        stampId: 'heart',
        color: '#EF4444',
        x: 0.8,
        y: 0.2,
      });
      await host.waitFor('STAMP_ADD_BC', (m) => m.item.id === 's42-a3-stamp');

      // Artist 0 uses wipers
      artists[0].send({ type: 'USE_WIPERS' });
      await host.waitFor('WIPERS_BC');

      t.mock.timers.tick(TIMINGS.LIVE_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
      t.mock.timers.tick(TIMINGS.FREEZE_MS);

      // -----------------------------------------------------------------------
      // ROUND 3: Lead Writer 2 + Final chaos
      // -----------------------------------------------------------------------
      await host.waitForSnapshot((s) => s.segment?.index === 2 && s.segment?.phase === 'PREP');
      assert.equal(host.lastSnapshot!.segment?.leadWriterId, writers[2].id, 'Writer 2 leads Round 3');

      writers[2].send({ type: 'SUBMIT_HEADLINE', headline: 'ФИНАЛЬНЫЙ РАУНД: КУЛЬМИНАЦИЯ ХАОСА' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

      // Saboteurs burst reactions
      for (let i = 0; i < 4; i++) {
        vandal.send({ type: 'SEND_REACTION', emoji: '😂' });
        await host.waitFor('REACTION_BC');
        t.mock.timers.tick(260);
      }

      t.mock.timers.tick(TIMINGS.LIVE_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
      t.mock.timers.tick(TIMINGS.FREEZE_MS);

      // -----------------------------------------------------------------------
      // REPLAY VERIFICATION
      // -----------------------------------------------------------------------
      const replaySnap = await host.waitForSnapshot((s) => s.screen === 'REPLAY');
      assert.ok(replaySnap.replay, 'Replay payload must exist');

      const replay = replaySnap.replay;
      assert.ok(
        replay.totalPlaybackDurationMs >= 40000 && replay.totalPlaybackDurationMs <= 55000,
        `Total duration must be in [40000, 55000] ms, got ${replay.totalPlaybackDurationMs}`,
      );

      // Verify chronology of events in replay
      for (let i = 1; i < replay.events.length; i++) {
        assert.ok(
          replay.events[i].t >= replay.events[i - 1].t,
          'Replay events must maintain monotonic non-decreasing timestamps',
        );
      }

      // Host returns to lobby
      host.send({ type: 'RETURN_TO_LOBBY' });
      await host.waitForSnapshot((s) => s.screen === 'LOBBY');
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Scenario 4.3: 6-Player Asymmetric Match with PREP Timeout & Fallback Headline
  // Source: ORIGINAL_REQUEST.md §R1.1, R1.2, R2; Explorer 3 §3.3
  // 6 players: 2 Writers, 3 Artists, 1 Saboteur.
  // Round 1 timeout -> server picks fallback headline, Rounds 2 & 3 custom headlines.
  // =========================================================================
  test('Scenario 4.3: 6-Player Asymmetric Match (Round 1 timeout fallback, Rounds 2-3 custom)', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    try {
      const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
        writers: 2,
        artists: 3,
        saboteurs: 1,
      });
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.screen === 'BROADCAST');

      // -----------------------------------------------------------------------
      // ROUND 1: PREP Timeout (30s) -> Fallback Headline
      // -----------------------------------------------------------------------
      await host.waitForSnapshot((s) => s.segment?.index === 0 && s.segment?.phase === 'PREP');
      // Lead writer is silent -> virtual clock ticks 30,000ms
      t.mock.timers.tick(TIMINGS.PREP_MAX_MS);

      const splashSnap1 = await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      const fallbackHeadline = splashSnap1.segment?.headline;
      assert.ok(
        FALLBACK_HEADLINES.includes(fallbackHeadline as any),
        `Round 1 must receive fallback headline, got "${fallbackHeadline}"`,
      );

      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
      t.mock.timers.tick(TIMINGS.LIVE_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
      t.mock.timers.tick(TIMINGS.FREEZE_MS);

      // -----------------------------------------------------------------------
      // ROUND 2: Custom Headline from Writer 1
      // -----------------------------------------------------------------------
      await host.waitForSnapshot((s) => s.segment?.index === 1 && s.segment?.phase === 'PREP');
      assert.equal(host.lastSnapshot!.segment?.leadWriterId, writers[1].id);

      const customHeadline2 = 'ВТОРОЙ РАУНД: ЭКСКЛЮЗИВ ОТ ВТОРОГО РЕДАКТОРА';
      writers[1].send({ type: 'SUBMIT_HEADLINE', headline: customHeadline2 });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
      t.mock.timers.tick(TIMINGS.LIVE_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
      t.mock.timers.tick(TIMINGS.FREEZE_MS);

      // -----------------------------------------------------------------------
      // ROUND 3: Custom Headline from Writer 0 (Rotation wrap)
      // -----------------------------------------------------------------------
      await host.waitForSnapshot((s) => s.segment?.index === 2 && s.segment?.phase === 'PREP');
      assert.equal(host.lastSnapshot!.segment?.leadWriterId, writers[0].id);

      const customHeadline3 = 'ТРЕТИЙ РАУНД: ВРАЧИ ИЗОБРЕЛИ ВЕЧНЫЙ ДЕСЕРТ';
      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: customHeadline3 });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');
      t.mock.timers.tick(TIMINGS.LIVE_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
      t.mock.timers.tick(TIMINGS.FREEZE_MS);

      // -----------------------------------------------------------------------
      // REPLAY ASSERTIONS
      // -----------------------------------------------------------------------
      const replaySnap = await host.waitForSnapshot((s) => s.screen === 'REPLAY');
      const replay = replaySnap.replay!;

      // Segment 0 must have the fallback headline
      const seg0 = replay.events.find((e) => e.type === 'SEGMENT_START' && (e as any).segmentIndex === 0);
      assert.equal((seg0 as any).headline, fallbackHeadline);

      // Segment 1 must have custom headline 2
      const seg1 = replay.events.find((e) => e.type === 'SEGMENT_START' && (e as any).segmentIndex === 1);
      assert.equal((seg1 as any).headline, customHeadline2);

      // Segment 2 must have custom headline 3
      const seg2 = replay.events.find((e) => e.type === 'SEGMENT_START' && (e as any).segmentIndex === 2);
      assert.equal((seg2 as any).headline, customHeadline3);

      assert.ok(
        replay.totalPlaybackDurationMs >= 40000 && replay.totalPlaybackDurationMs <= 55000,
        `Replay total duration must be in [40000, 55000] ms, got ${replay.totalPlaybackDurationMs}`,
      );

      host.send({ type: 'RETURN_TO_LOBBY' });
      await host.waitForSnapshot((s) => s.screen === 'LOBBY');
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Scenario 4.4: Mid-Game Disconnection, Host Migration & Token Reconnection
  // Source: ORIGINAL_REQUEST.md §R5; Explorer 3 §3.4
  // 5 players: Host disconnects during LIVE 1, session migrated to Artist 1,
  // former host reconnects with token and completes match to Replay.
  // =========================================================================
  test('Scenario 4.4: Mid-Game Disconnection, Host Migration & Token Reconnection', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    try {
      const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
        writers: 1,
        artists: 3,
        saboteurs: 1,
      });
      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.screen === 'BROADCAST');

      // Round 1
      writers[0].send({ type: 'SUBMIT_HEADLINE', headline: 'RECONNECT & HOST MIGRATION TEST' });
      await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
      t.mock.timers.tick(TIMINGS.SPLASH_MS);
      await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

      // Artist 0 draws stroke before disconnection
      artists[0].send({
        type: 'STROKE_START',
        id: 'stroke-before-dc',
        color: '#3B82F6',
        widthNorm: 0.02,
        point: { x: 0.2, y: 0.2 },
      });
      await artists[0].waitFor('STROKE_START_BC');

      // Save host token and room code
      const savedToken = host.token;
      const savedRoomCode = host.roomCode;
      const originalHostId = host.id;

      // Host disconnects during LIVE
      await host.close();

      // Artist 0 becomes new host
      const migratedSnap = await artists[0].waitForSnapshot(
        (s) => s.players.find((p) => p.id === artists[0].id)?.isHost === true,
      );
      assert.equal(
        migratedSnap.players.find((p) => p.id === artists[0].id)?.isHost,
        true,
        'Artist 0 must become host after original host disconnect',
      );

      // Former host reconnects via new socket connection using saved token
      const reconnectedHost = await harness.createClient('FormerHost');
      const welcomeSnap = await reconnectedHost.reconnect(savedRoomCode, savedToken);
      assert.equal(reconnectedHost.id, originalHostId, 'Reconnected client restores original player ID');
      assert.equal(welcomeSnap.screen, 'BROADCAST', 'Restored session is in BROADCAST screen');

      // Artist 1 draws stroke after reconnection
      artists[1].send({
        type: 'STROKE_START',
        id: 'stroke-after-reconnect',
        color: '#10B981',
        widthNorm: 0.03,
        point: { x: 0.7, y: 0.7 },
      });
      await artists[1].waitFor('STROKE_START_BC');

      // Finish Round 1
      t.mock.timers.tick(TIMINGS.LIVE_MS);
      await artists[0].waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
      t.mock.timers.tick(TIMINGS.FREEZE_MS);

      // Finish Rounds 2 and 3
      for (let i = 1; i < 3; i++) {
        await artists[0].waitForSnapshot((s) => s.segment?.index === i && s.segment?.phase === 'PREP');
        reconnectedHost.send({ type: 'SUBMIT_HEADLINE', headline: `CONTINUED BROADCAST ${i}` });
        await artists[0].waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await artists[0].waitForSnapshot((s) => s.segment?.phase === 'LIVE');
        t.mock.timers.tick(TIMINGS.LIVE_MS);
        await artists[0].waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
        t.mock.timers.tick(TIMINGS.FREEZE_MS);
      }

      // Replay verification
      const replaySnap = await artists[0].waitForSnapshot((s) => s.screen === 'REPLAY');
      const replay = replaySnap.replay!;

      // Both strokes (before DC and after reconnect) appear in replay events
      const beforeStroke = replay.events.find(
        (e) => e.type === 'STROKE_ADD' && (e as any).item.id === 'stroke-before-dc',
      );
      const afterStroke = replay.events.find(
        (e) => e.type === 'STROKE_ADD' && (e as any).item.id === 'stroke-after-reconnect',
      );
      assert.ok(beforeStroke, 'Stroke drawn before host disconnect must be preserved in replay');
      assert.ok(afterStroke, 'Stroke drawn after reconnect must be preserved in replay');

      // New host can return to lobby
      artists[0].send({ type: 'RETURN_TO_LOBBY' });
      await artists[0].waitForSnapshot((s) => s.screen === 'LOBBY');
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Scenario 4.5: 8-Player 4-Writer Match (4 segments, rotating leads, replay)
  // Source: ORIGINAL_REQUEST.md §R1, R2; Explorer 3 §3.5
  // 8 players (4 Writers, 2 Artists, 2 Saboteurs) with testMode: true.
  // Segment count N = max(3, 4) = 4 segments.
  // =========================================================================
  test('Scenario 4.5: 8-Player 4-Writer Match (4 segments, 4 rotating leads, adaptive replay)', async (t) => {
    const harness = new TestHarness();
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    try {
      const { host, writers, artists, saboteurs } = await harness.setupGameWithRoles({
        writers: 4,
        artists: 2,
        saboteurs: 2,
        testMode: true,
      });

      t.mock.timers.tick(650);
      await host.waitForSnapshot((s) => s.screen === 'BROADCAST');

      const room = Array.from((harness.roomManager as any).rooms.values())[0] as any;
      assert.equal(
        room.writerQueue.length,
        4,
        '4 writers produce exactly 4 segments (N = max(3, 4) = 4)',
      );

      const segmentHeadlines = [
        'СЮЖЕТ 1: ТАЙНЫЙ ОСТРОВ В РЕКЕ МОСКВЕ',
        'СЮЖЕТ 2: СВЕРХСКОРОСТНЫЕ САМОКАТЫ ЗАПРЕЩЕНЫ',
        'СЮЖЕТ 3: КОФЕЙНИ ВВЕЛИ НАЛОГ НА САХАР',
        'СЮЖЕТ 4: СНЕГОПАД В ИЮЛЕ УДИВИЛ ВСЕХ',
      ];

      // Execute 4 full segments sequentially, each led by its respective writer
      for (let round = 0; round < 4; round++) {
        const prepSnap = await host.waitForSnapshot(
          (s) => s.segment?.index === round && s.segment?.phase === 'PREP',
        );
        assert.equal(
          prepSnap.segment?.leadWriterId,
          writers[round].id,
          `Round ${round} must be led by Writer ${round}`,
        );

        writers[round].send({ type: 'SUBMIT_HEADLINE', headline: segmentHeadlines[round] });
        await host.waitForSnapshot((s) => s.segment?.phase === 'SPLASH');
        t.mock.timers.tick(TIMINGS.SPLASH_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'LIVE');

        // Drawing / non-spike actions during LIVE
        if (round === 0) {
          artists[0].send({
            type: 'STROKE_START',
            id: `stroke-r${round}`,
            color: '#3B82F6',
            widthNorm: 0.02,
            point: { x: 0.2, y: 0.2 },
          });
          await host.waitFor('STROKE_START_BC');
        } else if (round === 1) {
          writers[1].send({ type: 'ADD_TICKER', text: 'Бегущая строка раунда 2' });
          await host.waitFor('TICKER_ADD_BC');
        } else if (round === 2) {
          artists[1].send({
            type: 'STROKE_START',
            id: `stroke-r${round}`,
            color: '#10B981',
            widthNorm: 0.03,
            point: { x: 0.5, y: 0.5 },
          });
          await host.waitFor('STROKE_START_BC');
        } else {
          saboteurs[1].send({ type: 'SEND_REACTION', emoji: '👏' });
          await host.waitFor('REACTION_BC');
        }

        t.mock.timers.tick(TIMINGS.LIVE_MS);
        await host.waitForSnapshot((s) => s.segment?.phase === 'FREEZE');
        t.mock.timers.tick(TIMINGS.FREEZE_MS);
      }

      // Replay verification
      const replaySnap = await host.waitForSnapshot((s) => s.screen === 'REPLAY');
      assert.ok(replaySnap.replay, 'Replay payload must exist');

      const replay = replaySnap.replay;

      // Exactly 4 SEGMENT_START events
      const segmentStartEvents = replay.events.filter((e) => e.type === 'SEGMENT_START');
      assert.equal(segmentStartEvents.length, 4, 'Replay must contain exactly 4 SEGMENT_START events');

      for (let i = 0; i < 4; i++) {
        assert.equal(
          (segmentStartEvents[i] as any).headline,
          segmentHeadlines[i],
          `Replay segment ${i} must preserve writer headline`,
        );
      }

      // 4 rounds cannot fit the 3-round 40–55s target inside the 2.5x–3.5x band,
      // so the replay keeps its watchable speed and grows adaptively instead.
      const nonPeaks = replay.speedRanges.filter((r) => !r.isPeak);
      assert.ok(nonPeaks.length > 0, 'Replay must contain non-peak speed ranges');
      for (const r of nonPeaks) {
        assert.ok(
          r.speed >= 2.5 && r.speed <= 3.5,
          `4-segment replay base speed must stay in [2.50, 3.50], got ${r.speed}`,
        );
      }
      assert.ok(
        replay.totalPlaybackDurationMs >= 40000 && replay.totalPlaybackDurationMs <= 90000,
        `4-segment adaptive replay duration out of range, got ${replay.totalPlaybackDurationMs}`,
      );

      // Host returns to lobby
      host.send({ type: 'RETURN_TO_LOBBY' });
      const lobbySnap = await host.waitForSnapshot((s) => s.screen === 'LOBBY');
      assert.equal(lobbySnap.screen, 'LOBBY');
      assert.equal(lobbySnap.segment, null);
      assert.equal(lobbySnap.replay, null);
    } finally {
      await harness.cleanup();
    }
  });
});
