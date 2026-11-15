import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReplayPayload,
  type RecordedSegment,
} from '../server/replayAnalyzer.js';
import { TIMINGS } from '../shared/constants.js';
import type {
  ReplayEvent,
  DrawStrokeItem,
  DrawStampItem,
  SabotageVisualItem,
} from '../shared/protocol.js';

describe('Milestone 3 Empirical Adversarial Challenge: Event Synchronization & Ordering', () => {
  // Helper to make full-length live segment (51,000ms raw)
  function makeFullSeg(idx: number, events: ReplayEvent[] = []): RecordedSegment {
    return {
      segmentIndex: idx,
      headline: `HEADLINE ROUND ${idx + 1}`,
      writerName: `Writer ${idx + 1}`,
      sourceDurationMs: TIMINGS.SPLASH_MS + TIMINGS.LIVE_MS + TIMINGS.FREEZE_MS, // 51,000ms
      events,
    };
  }

  // =========================================================================
  // Suite A: Dirty Input Fuzzing & Negative Timestamps
  // =========================================================================
  describe('Suite A: Dirty Input Fuzzing & Negative Timestamps', () => {
    it('A.1 drops 100% of events with negative timestamps (t < 0) across diverse ranges', () => {
      const dirtyEvents: ReplayEvent[] = [
        { t: -60000, type: 'WIPERS' },
        { t: -30000, type: 'PHASE', phase: 'PREP' },
        { t: -15000, type: 'REACTION', id: 'neg-1', emoji: '💀', lane: 0.1 },
        { t: -500, type: 'TICKER_HACK', id: 'th-neg', hackedText: 'HACK' },
        { t: -1, type: 'UNDO_ITEM', itemId: 'item-neg' },
        { t: 0, type: 'REACTION', id: 'zero-1', emoji: '🎉', lane: 0.5 },
        { t: 1500, type: 'REACTION', id: 'pos-1', emoji: '🔥', lane: 0.2 },
        { t: 10000, type: 'WIPERS' },
      ];

      const seg = makeFullSeg(0, dirtyEvents);
      const payload = buildReplayPayload([seg], Date.now());

      const negEvents = payload.events.filter((e) => e.t < 0);
      assert.equal(negEvents.length, 0, `Expected 0 negative events, found ${negEvents.length}`);

      // Verify legitimate events at t >= 0 survived
      const zeroEv = payload.events.find((e) => e.type === 'REACTION' && (e as any).id === 'zero-1');
      const posEv = payload.events.find((e) => e.type === 'REACTION' && (e as any).id === 'pos-1');
      assert.ok(zeroEv, 'Event at t=0 must be preserved');
      assert.ok(posEv, 'Event at t=1500 must be preserved');
      assert.equal(zeroEv.t, 0);
    });

    it('A.2 drops events with negative timestamps in pre-trimmed segments (< 50,000ms)', () => {
      const seg: RecordedSegment = {
        segmentIndex: 0,
        headline: 'PRE-TRIMMED MOCK',
        writerName: 'Writer 1',
        sourceDurationMs: 35000,
        events: [
          { t: -1000, type: 'REACTION', id: 'neg-trim', emoji: '❌', lane: 0.3 },
          { t: -1, type: 'PHASE', phase: 'PREP' },
          { t: 500, type: 'REACTION', id: 'pos-trim', emoji: '✅', lane: 0.8 },
        ],
      };

      const payload = buildReplayPayload([seg], Date.now());
      assert.equal(payload.events.some((e) => e.t < 0), false);
      const posEv = payload.events.find((e) => e.type === 'REACTION' && (e as any).id === 'pos-trim');
      assert.ok(posEv);
    });

    it('A.3 handles out-of-order and fully reversed timestamps, sorting them non-decreasingly', () => {
      const reversedEvents: ReplayEvent[] = [
        { t: 50000, type: 'REACTION', id: 'r-50k', emoji: '5️⃣', lane: 0.5 },
        { t: 45000, type: 'REACTION', id: 'r-45k', emoji: '4️⃣', lane: 0.5 },
        { t: 30000, type: 'REACTION', id: 'r-30k', emoji: '3️⃣', lane: 0.5 },
        { t: 15000, type: 'REACTION', id: 'r-15k', emoji: '2️⃣', lane: 0.5 },
        { t: 5000, type: 'REACTION', id: 'r-5k', emoji: '1️⃣', lane: 0.5 },
        { t: 100, type: 'REACTION', id: 'r-100', emoji: '0️⃣', lane: 0.5 },
      ];

      const seg = makeFullSeg(0, reversedEvents);
      const payload = buildReplayPayload([seg], Date.now());

      for (let i = 0; i < payload.events.length - 1; i++) {
        assert.ok(
          payload.events[i].t <= payload.events[i + 1].t,
          `Event ${i} (t=${payload.events[i].t}) must be <= Event ${i + 1} (t=${payload.events[i + 1].t})`,
        );
      }
    });

    it('A.4 handles duplicate timestamps without event dropping or corruption', () => {
      const dupEvents: ReplayEvent[] = [];
      // 20 events all at exact live time 15,000ms
      for (let i = 0; i < 20; i++) {
        dupEvents.push({
          t: 15000,
          type: 'REACTION',
          id: `dup-${i}`,
          emoji: '💥',
          lane: (i % 10) / 10,
        });
      }

      const seg = makeFullSeg(0, dupEvents);
      const payload = buildReplayPayload([seg], Date.now());

      const reactions = payload.events.filter((e) => e.type === 'REACTION' && (e as any).emoji === '💥');
      assert.equal(reactions.length, 20, 'All 20 duplicate timestamp events must be preserved');

      // Mapped virtual coordinate for 15,000ms: 1200 + (15000 - 3000) = 13200
      for (const r of reactions) {
        assert.equal(r.t, 13200);
      }
    });

    it('A.5 handles massive simultaneous event flood (50 reactions at the exact same millisecond)', () => {
      const floodEvents: ReplayEvent[] = [];
      const floodTime = 20000; // LIVE window
      for (let i = 0; i < 50; i++) {
        floodEvents.push({
          t: floodTime,
          type: 'REACTION',
          id: `flood-50-${i}`,
          emoji: i % 2 === 0 ? '😂' : '🚀',
          lane: Number(((i * 0.02) % 1.0).toFixed(2)),
        });
      }

      const seg = makeFullSeg(0, floodEvents);
      const payload = buildReplayPayload([seg], Date.now());

      const floodInPayload = payload.events.filter(
        (e) => e.type === 'REACTION' && (e as any).id?.startsWith('flood-50-'),
      );
      assert.equal(floodInPayload.length, 50, 'All 50 flooded reactions must be retained');

      // Check sorting invariant
      for (let i = 0; i < payload.events.length - 1; i++) {
        assert.ok(payload.events[i].t <= payload.events[i + 1].t);
      }

      // Check that peak detector recognized the 50-reaction heat burst (50 * 1.5 = 75 score)
      // Virtual time for 20000ms: 1200 + (20000 - 3000) = 18200
      const peakRange = payload.speedRanges.find((r) => r.isPeak && r.startMs <= 18200 && r.endMs >= 18200);
      assert.ok(peakRange, 'Peak detector must encompass the massive 50-reaction flood');
      assert.equal(peakRange.speed, 1.0);
    });
  });

  // =========================================================================
  // Suite B: Chronological Ordering Oracle
  // =========================================================================
  describe('Suite B: Chronological Ordering Oracle', () => {
    it('B.1 assert payload.events is strictly sorted by non-decreasing timestamp across all segments', () => {
      const seg1 = makeFullSeg(0, [
        { t: 40000, type: 'WIPERS' },
        { t: 1000, type: 'REACTION', id: 's1-1', emoji: 'A', lane: 0.1 },
        { t: 25000, type: 'TICKER_HACK', id: 'th1', hackedText: 'H1' },
      ]);
      const seg2 = makeFullSeg(1, [
        { t: 49000, type: 'REACTION', id: 's2-1', emoji: 'B', lane: 0.2 },
        { t: 500, type: 'REACTION', id: 's2-2', emoji: 'C', lane: 0.3 },
        { t: 12000, type: 'WIPERS' },
      ]);
      const seg3 = makeFullSeg(2, [
        { t: 0, type: 'REACTION', id: 's3-1', emoji: 'D', lane: 0.4 },
        { t: 47999, type: 'WIPERS' },
      ]);

      const payload = buildReplayPayload([seg1, seg2, seg3], Date.now());

      assert.ok(payload.events.length >= 10, 'Must have events and synthetic anchors');
      for (let i = 0; i < payload.events.length - 1; i++) {
        assert.ok(
          payload.events[i].t <= payload.events[i + 1].t,
          `Chronological violation at index ${i}: t=${payload.events[i].t} > t=${payload.events[i + 1].t}`,
        );
      }
    });

    it('B.2 multi-segment inter-boundary chronological continuity (Seg 0 FREEZE vs Seg 1 SPLASH)', () => {
      const seg0 = makeFullSeg(0, [
        { t: 51000, type: 'REACTION', id: 'boundary-end-0', emoji: '🏁', lane: 0.5 },
      ]);
      const seg1 = makeFullSeg(1, [
        { t: 0, type: 'REACTION', id: 'boundary-start-1', emoji: '🏁', lane: 0.5 },
      ]);

      const payload = buildReplayPayload([seg0, seg1], Date.now());

      const ev0 = payload.events.find((e) => (e as any).id === 'boundary-end-0');
      const ev1 = payload.events.find((e) => (e as any).id === 'boundary-start-1');

      assert.ok(ev0 && ev1);
      // Segment 0 ends at virtual 47200
      assert.equal(ev0.t, 47200);
      // Segment 1 starts at virtual 47200
      assert.equal(ev1.t, 47200);

      // Verify no inversion in full array
      for (let i = 0; i < payload.events.length - 1; i++) {
        assert.ok(payload.events[i].t <= payload.events[i + 1].t);
      }
    });
  });

  // =========================================================================
  // Suite C: PREP Phase Exclusion Oracle
  // =========================================================================
  describe('Suite C: PREP Phase Exclusion Oracle', () => {
    it('C.1 zero PREP events leak into payload.events in full live segments', () => {
      const seg = makeFullSeg(0, [
        { t: -30000, type: 'PHASE', phase: 'PREP' },
        { t: -15000, type: 'PHASE', phase: 'PREP' },
        { t: -1, type: 'PHASE', phase: 'PREP' },
        { t: 0, type: 'PHASE', phase: 'PREP' }, // Spoofed at t=0
        { t: 5000, type: 'PHASE', phase: 'PREP' }, // Spoofed during LIVE
        { t: 10000, type: 'REACTION', id: 'valid-r', emoji: '💎', lane: 0.5 },
      ]);

      const payload = buildReplayPayload([seg], Date.now());

      const prepEvents = payload.events.filter(
        (e) => e.type === 'PHASE' && (e as any).phase === 'PREP',
      );
      assert.equal(prepEvents.length, 0, 'Zero PREP events must leak into replay payload');

      // Also verify that any event with property phase === 'PREP' is zero
      const anyPrep = payload.events.filter((e) => (e as any).phase === 'PREP');
      assert.equal(anyPrep.length, 0, 'Zero events of any type may bear phase PREP');
    });

    it('C.2 zero PREP events leak in pre-trimmed segments (< 50,000ms)', () => {
      const seg: RecordedSegment = {
        segmentIndex: 0,
        headline: 'MOCK PREP LEAK CHECK',
        writerName: 'Writer 1',
        sourceDurationMs: 25000,
        events: [
          { t: -10000, type: 'PHASE', phase: 'PREP' },
          { t: 0, type: 'PHASE', phase: 'PREP' },
          { t: 2000, type: 'PHASE', phase: 'PREP' },
          { t: 5000, type: 'REACTION', id: 'trim-r', emoji: '🌟', lane: 0.5 },
        ],
      };

      const payload = buildReplayPayload([seg], Date.now());
      const prepEvents = payload.events.filter(
        (e) => (e as any).phase === 'PREP',
      );
      assert.equal(prepEvents.length, 0);
    });

    it('C.3 synthetic phase anchors contain only SPLASH, LIVE, and FREEZE', () => {
      const seg = makeFullSeg(0, []);
      const payload = buildReplayPayload([seg], Date.now());

      const phaseEvents = payload.events.filter((e) => e.type === 'PHASE');
      const phases = phaseEvents.map((e) => (e as any).phase);

      assert.deepEqual(phases, ['SPLASH', 'LIVE', 'FREEZE']);
      assert.ok(!phases.includes('PREP'));
    });
  });

  // =========================================================================
  // Suite D: Boundary Preservation & Coordinate Mapping Oracle
  // =========================================================================
  describe('Suite D: Boundary Preservation & Coordinate Mapping Oracle', () => {
    it('D.1 verifies exact live boundaries (0, 3000, 48000, 51000) map to (0, 1200, 46200, 47200)', () => {
      const boundaryEvents: ReplayEvent[] = [
        { t: 0, type: 'REACTION', id: 'bound-0', emoji: '0️⃣', lane: 0.1 },
        { t: 3000, type: 'REACTION', id: 'bound-3k', emoji: '3️⃣', lane: 0.2 },
        { t: 48000, type: 'REACTION', id: 'bound-48k', emoji: '4️⃣', lane: 0.3 },
        { t: 51000, type: 'REACTION', id: 'bound-51k', emoji: '5️⃣', lane: 0.4 },
      ];

      const seg = makeFullSeg(0, boundaryEvents);
      const payload = buildReplayPayload([seg], Date.now());

      const e0 = payload.events.find((e) => (e as any).id === 'bound-0');
      const e3k = payload.events.find((e) => (e as any).id === 'bound-3k');
      const e48k = payload.events.find((e) => (e as any).id === 'bound-48k');
      const e51k = payload.events.find((e) => (e as any).id === 'bound-51k');

      assert.ok(e0 && e3k && e48k && e51k);
      assert.equal(e0.t, 0, 't=0ms must map to virtual 0ms');
      assert.equal(e3k.t, 1200, 't=3000ms must map to virtual 1200ms');
      assert.equal(e48k.t, 46200, 't=48000ms must map to virtual 46200ms');
      assert.equal(e51k.t, 47200, 't=51000ms must map to virtual 47200ms');
    });

    it('D.2 verifies segment k=1 boundaries map to (47200, 48400, 93400, 94400)', () => {
      const seg0 = makeFullSeg(0, []);
      const seg1 = makeFullSeg(1, [
        { t: 0, type: 'REACTION', id: 's1-b0', emoji: '0️⃣', lane: 0.1 },
        { t: 3000, type: 'REACTION', id: 's1-b3k', emoji: '3️⃣', lane: 0.2 },
        { t: 48000, type: 'REACTION', id: 's1-b48k', emoji: '4️⃣', lane: 0.3 },
        { t: 51000, type: 'REACTION', id: 's1-b51k', emoji: '5️⃣', lane: 0.4 },
      ]);

      const payload = buildReplayPayload([seg0, seg1], Date.now());

      const e0 = payload.events.find((e) => (e as any).id === 's1-b0');
      const e3k = payload.events.find((e) => (e as any).id === 's1-b3k');
      const e48k = payload.events.find((e) => (e as any).id === 's1-b48k');
      const e51k = payload.events.find((e) => (e as any).id === 's1-b51k');

      assert.ok(e0 && e3k && e48k && e51k);
      assert.equal(e0.t, 47200, 'Seg 1 t=0 must map to 47200');
      assert.equal(e3k.t, 48400, 'Seg 1 t=3000 must map to 47200 + 1200 = 48400');
      assert.equal(e48k.t, 93400, 'Seg 1 t=48000 must map to 47200 + 46200 = 93400');
      assert.equal(e51k.t, 94400, 'Seg 1 t=51000 must map to 47200 + 47200 = 94400');
    });

    it('D.3 verifies intermediate linear piecewise mapping in SPLASH, LIVE, and FREEZE', () => {
      const intermediateEvents: ReplayEvent[] = [
        // SPLASH midpoint: t = 1500 -> 1500 * 0.4 = 600
        { t: 1500, type: 'REACTION', id: 'mid-splash', emoji: '🌊', lane: 0.5 },
        // LIVE midpoint: t = 25500 -> 1200 + (25500 - 3000) = 23700
        { t: 25500, type: 'REACTION', id: 'mid-live', emoji: '⚡', lane: 0.5 },
        // FREEZE midpoint: t = 49500 -> 46200 + (49500 - 48000) / 3 = 46700
        { t: 49500, type: 'REACTION', id: 'mid-freeze', emoji: '🧊', lane: 0.5 },
      ];

      const seg = makeFullSeg(0, intermediateEvents);
      const payload = buildReplayPayload([seg], Date.now());

      const eSplash = payload.events.find((e) => (e as any).id === 'mid-splash');
      const eLive = payload.events.find((e) => (e as any).id === 'mid-live');
      const eFreeze = payload.events.find((e) => (e as any).id === 'mid-freeze');

      assert.ok(eSplash && eLive && eFreeze);
      assert.equal(eSplash.t, 600);
      assert.equal(eLive.t, 23700);
      assert.equal(eFreeze.t, 46700);
    });
  });

  // =========================================================================
  // Suite E: Reaction & Sabotage Payload Integrity
  // =========================================================================
  describe('Suite E: Reaction & Sabotage Payload Integrity', () => {
    it('E.1 emoji reactions preserve id, emoji, and normalized lane values across various unicode types', () => {
      const testReactions: Array<{ id: string; emoji: string; lane: number }> = [
        { id: 'rx-classic', emoji: '😂', lane: 0.125 },
        { id: 'rx-zwj', emoji: '👨‍👩‍👧‍👦', lane: 0.333 },
        { id: 'rx-flag', emoji: '🇺🇳', lane: 0.5 },
        { id: 'rx-skin', emoji: '👍🏽', lane: 0.75 },
        { id: 'rx-heart', emoji: '❤️', lane: 0.888 },
        { id: 'rx-lane-0', emoji: '🎯', lane: 0.0 },
        { id: 'rx-lane-1', emoji: '🏆', lane: 1.0 },
      ];

      const events: ReplayEvent[] = testReactions.map((r, i) => ({
        t: 5000 + i * 2000,
        type: 'REACTION',
        id: r.id,
        emoji: r.emoji,
        lane: r.lane,
      }));

      const seg = makeFullSeg(0, events);
      const payload = buildReplayPayload([seg], Date.now());

      for (const expected of testReactions) {
        const found = payload.events.find(
          (e) => e.type === 'REACTION' && (e as any).id === expected.id,
        ) as any;
        assert.ok(found, `Reaction ${expected.id} must exist in payload.events`);
        assert.equal(found.emoji, expected.emoji, `Emoji for ${expected.id} must be preserved`);
        assert.equal(found.lane, expected.lane, `Lane for ${expected.id} must be preserved`);
      }
    });

    it('E.2 sabotage visual & FX integrity: verifies effect metadata is intact', () => {
      const visualItem: SabotageVisualItem = {
        id: 'tomato-42',
        type: 'tomato',
        x: 0.45,
        y: 0.55,
        scale: 1.25,
        rotation: 0.78,
        sticker: 'splat_large',
      };

      const fxEvent: ReplayEvent = {
        t: 12000,
        type: 'SABOTAGE_FX',
        fx: 'glitch',
      };

      const visualEvent: ReplayEvent = {
        t: 14000,
        type: 'SABOTAGE_VISUAL',
        item: visualItem,
      };

      const seg = makeFullSeg(0, [visualEvent, fxEvent]);
      const payload = buildReplayPayload([seg], Date.now());

      const foundFx = payload.events.find((e) => e.type === 'SABOTAGE_FX') as any;
      assert.ok(foundFx, 'SABOTAGE_FX event must exist');
      assert.equal(foundFx.fx, 'glitch', 'FX type must be preserved');

      const foundVis = payload.events.find((e) => e.type === 'SABOTAGE_VISUAL') as any;
      assert.ok(foundVis, 'SABOTAGE_VISUAL event must exist');
      assert.deepEqual(foundVis.item, visualItem, 'Visual item payload must match exactly');
    });

    it('E.3 drawing items (strokes, stamps, wipers, undo) retain full data integrity', () => {
      const stroke: DrawStrokeItem = {
        kind: 'stroke',
        id: 'strk-100',
        authorId: 'artist-1',
        color: '#FF0055',
        widthNorm: 0.05,
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.3, y: 0.4 },
        ],
      };

      const stamp: DrawStampItem = {
        kind: 'stamp',
        id: 'stamp-200',
        authorId: 'artist-1',
        stampId: 'star',
        color: '#FFFF00',
        x: 0.7,
        y: 0.8,
        scaleNorm: 0.16,
      };

      const events: ReplayEvent[] = [
        { t: 6000, type: 'STROKE_ADD', item: stroke },
        { t: 7000, type: 'STAMP_ADD', item: stamp },
        { t: 8000, type: 'UNDO_ITEM', itemId: 'stamp-200' },
        { t: 9000, type: 'WIPERS' },
        { t: 10000, type: 'TICKER_ADD', id: 'tick-1', authorName: 'Writer 1', text: 'BREAKING NEWS' },
        { t: 11000, type: 'TICKER_HACK', id: 'tick-1', hackedText: 'BR@AKING N#WS' },
      ];

      const seg = makeFullSeg(0, events);
      const payload = buildReplayPayload([seg], Date.now());

      const foundStroke = payload.events.find((e) => e.type === 'STROKE_ADD') as any;
      assert.deepEqual(foundStroke.item, stroke);

      const foundStamp = payload.events.find((e) => e.type === 'STAMP_ADD') as any;
      assert.deepEqual(foundStamp.item, stamp);

      const foundUndo = payload.events.find((e) => e.type === 'UNDO_ITEM') as any;
      assert.equal(foundUndo.itemId, 'stamp-200');

      const foundWipers = payload.events.find((e) => e.type === 'WIPERS');
      assert.ok(foundWipers);

      const foundTickerAdd = payload.events.find((e) => e.type === 'TICKER_ADD') as any;
      assert.equal(foundTickerAdd.text, 'BREAKING NEWS');

      const foundTickerHack = payload.events.find((e) => e.type === 'TICKER_HACK') as any;
      assert.equal(foundTickerHack.hackedText, 'BR@AKING N#WS');
    });
  });

  // =========================================================================
  // Suite F: Robustness & Degenerate Inputs
  // =========================================================================
  describe('Suite F: Robustness & Degenerate Inputs', () => {
    it('F.1 does not throw on empty recordedSegments array ([])', () => {
      assert.doesNotThrow(() => {
        const payload = buildReplayPayload([], Date.now());
        assert.ok(payload);
        assert.equal(payload.events.length, 0);
        assert.ok(payload.totalSourceDurationMs >= 1000);
        assert.ok(payload.totalPlaybackDurationMs > 0);
        assert.ok(payload.speedRanges.length >= 1);
        assert.equal(payload.speedRanges[0].startMs, 0);
        assert.equal(payload.speedRanges[payload.speedRanges.length - 1].endMs, payload.totalSourceDurationMs);
      });
    });

    it('F.2 does not throw on segments with 0 events (events: [])', () => {
      const segEmpty = makeFullSeg(0, []);
      assert.doesNotThrow(() => {
        const payload = buildReplayPayload([segEmpty], Date.now());
        assert.ok(payload);
        assert.equal(payload.totalSourceDurationMs, 47200);
        assert.ok(payload.speedRanges.some((r) => r.isPeak));
        assert.ok(payload.totalPlaybackDurationMs > 0);
        // Only synthetic anchors present
        assert.ok(payload.events.length >= 4);
      });
    });

    it('F.3 multiple segments all with 0 events allocate valid default peak windows', () => {
      const segs = [makeFullSeg(0, []), makeFullSeg(1, []), makeFullSeg(2, [])];
      const payload = buildReplayPayload(segs, Date.now());

      assert.equal(payload.totalSourceDurationMs, 3 * 47200);
      const peaks = payload.speedRanges.filter((r) => r.isPeak);
      assert.equal(peaks.length, 3, 'Exactly 1 default peak per round must be assigned');
      for (const p of peaks) {
        assert.equal(p.endMs - p.startMs, 3500);
        assert.equal(p.speed, 1.0);
      }
      assert.ok(payload.totalPlaybackDurationMs >= 40000 && payload.totalPlaybackDurationMs <= 55000);
    });

    it('F.4 handles missing or fallback headlines/writerNames gracefully', () => {
      const rawDur = TIMINGS.SPLASH_MS + TIMINGS.LIVE_MS + TIMINGS.FREEZE_MS;
      const seg: RecordedSegment = {
        segmentIndex: 0,
        headline: '',
        writerName: '',
        sourceDurationMs: rawDur,
        events: [],
      };

      const payload = buildReplayPayload([seg], Date.now());
      const segStart = payload.events.find((e) => e.type === 'SEGMENT_START') as any;
      assert.ok(segStart);
      assert.ok(typeof segStart.headline === 'string' && segStart.headline.length > 0);
      assert.ok(typeof segStart.writerName === 'string' && segStart.writerName.length > 0);
    });

    it('F.5 handles sourceDurationMs = 0 without dividing by zero or NaN', () => {
      const seg: RecordedSegment = {
        segmentIndex: 0,
        headline: 'ZERO DURATION',
        writerName: 'Writer 1',
        sourceDurationMs: 0,
        events: [],
      };

      const payload = buildReplayPayload([seg], Date.now());
      assert.ok(!Number.isNaN(payload.totalSourceDurationMs));
      assert.ok(!Number.isNaN(payload.totalPlaybackDurationMs));
      for (const r of payload.speedRanges) {
        assert.ok(!Number.isNaN(r.startMs));
        assert.ok(!Number.isNaN(r.endMs));
        assert.ok(!Number.isNaN(r.speed));
      }
    });

    it('F.6 rounds fractional timestamps to integer milliseconds', () => {
      const seg = makeFullSeg(0, [
        { t: 1234.567, type: 'REACTION', id: 'frac-1', emoji: '🔢', lane: 0.5 },
        { t: 25555.8, type: 'REACTION', id: 'frac-2', emoji: '🔢', lane: 0.5 },
      ]);

      const payload = buildReplayPayload([seg], Date.now());
      for (const ev of payload.events) {
        assert.equal(Math.floor(ev.t), ev.t, `Timestamp ${ev.t} must be integer millisecond`);
      }
    });
  });

  // =========================================================================
  // Suite G: Randomized Fuzz Invariant & High-Load Stress Performance
  // =========================================================================
  describe('Suite G: Randomized Fuzz Invariant & High-Load Stress Performance', () => {
    it('G.1 executes 100 randomized dirty configurations asserting all oracles hold', () => {
      for (let run = 0; run < 100; run++) {
        const numSegments = 1 + (run % 4); // 1 to 4 segments
        const segs: RecordedSegment[] = [];

        for (let s = 0; s < numSegments; s++) {
          const numEvents = Math.floor(Math.random() * 20);
          const evs: ReplayEvent[] = [];
          for (let e = 0; e < numEvents; e++) {
            // Timestamp can be negative, 0, within bounds, or exceeding bounds
            const randT = Math.floor(Math.random() * 80000) - 15000;
            const randType = Math.random();
            if (randType < 0.2) {
              evs.push({ t: randT, type: 'PHASE', phase: 'PREP' as any });
            } else if (randType < 0.6) {
              evs.push({
                t: randT,
                type: 'REACTION',
                id: `fuzz-${run}-${s}-${e}`,
                emoji: '🎲',
                lane: Math.random(),
              });
            } else if (randType < 0.8) {
              evs.push({ t: randT, type: 'WIPERS' });
            } else {
              evs.push({ t: randT, type: 'SABOTAGE_FX', fx: 'glitch' });
            }
          }
          segs.push(makeFullSeg(s, evs));
        }

        const payload = buildReplayPayload(segs, Date.now());

        // Invariant 1: Strictly non-decreasing timestamps
        for (let i = 0; i < payload.events.length - 1; i++) {
          assert.ok(
            payload.events[i].t <= payload.events[i + 1].t,
            `Run ${run}: Monotonicity violation at index ${i}`,
          );
        }

        // Invariant 2: Zero PREP events
        const hasPrep = payload.events.some((ev) => (ev as any).phase === 'PREP');
        assert.equal(hasPrep, false, `Run ${run}: Leaked PREP event`);

        // Invariant 3: Zero negative timestamps
        const hasNegative = payload.events.some((ev) => ev.t < 0);
        assert.equal(hasNegative, false, `Run ${run}: Negative timestamp found`);

        // Invariant 4: Gapless speed range contiguity
        assert.equal(payload.speedRanges[0].startMs, 0);
        for (let i = 0; i < payload.speedRanges.length - 1; i++) {
          assert.equal(
            payload.speedRanges[i].endMs,
            payload.speedRanges[i + 1].startMs,
            `Run ${run}: Range gap between ${i} and ${i + 1}`,
          );
        }
        assert.equal(
          payload.speedRanges[payload.speedRanges.length - 1].endMs,
          payload.totalSourceDurationMs,
        );

        // Invariant 5: Integer total duration
        assert.ok(payload.totalPlaybackDurationMs > 0);
        assert.equal(Math.floor(payload.totalPlaybackDurationMs), payload.totalPlaybackDurationMs);
      }
    });

    it('G.2 high load stress test: 1,000 events across 3 rounds executes in < 50ms', () => {
      const segs: RecordedSegment[] = [];
      let eventCount = 0;

      for (let s = 0; s < 3; s++) {
        const events: ReplayEvent[] = [];
        for (let i = 0; i < 334; i++) {
          const t = Math.floor(Math.random() * 51000);
          events.push({
            t,
            type: 'REACTION',
            id: `stress-${s}-${i}`,
            emoji: '🔥',
            lane: 0.5,
          });
          eventCount++;
        }
        segs.push(makeFullSeg(s, events));
      }

      const t0 = performance.now();
      const payload = buildReplayPayload(segs, Date.now());
      const elapsedMs = performance.now() - t0;

      assert.ok(
        elapsedMs < 50,
        `Replay compilation for 1,000 events must take < 50ms (took ${elapsedMs.toFixed(2)}ms)`,
      );
      assert.ok(payload.events.length >= eventCount);

      // Verify monotonicity under high load
      for (let i = 0; i < payload.events.length - 1; i++) {
        assert.ok(payload.events[i].t <= payload.events[i + 1].t);
      }
    });

    it('G.3 massive scale stress test: 5,000 events across 5 rounds maintains integrity', () => {
      const segs: RecordedSegment[] = [];
      for (let s = 0; s < 5; s++) {
        const events: ReplayEvent[] = [];
        for (let i = 0; i < 1000; i++) {
          events.push({
            t: Math.floor(Math.random() * 51000),
            type: 'REACTION',
            id: `scale-${s}-${i}`,
            emoji: '⚡',
            lane: 0.5,
          });
        }
        segs.push(makeFullSeg(s, events));
      }

      const t0 = performance.now();
      const payload = buildReplayPayload(segs, Date.now());
      const elapsedMs = performance.now() - t0;

      assert.ok(payload.events.length >= 5000);
      assert.ok(elapsedMs < 200, `5,000 events compiled in ${elapsedMs.toFixed(2)}ms (< 200ms)`);

      // Verify monotonicity
      for (let i = 0; i < payload.events.length - 1; i++) {
        assert.ok(payload.events[i].t <= payload.events[i + 1].t);
      }

      // Check duration constraints for 5 rounds: the 2.5x–3.5x speed band is
      // preserved, so a 5-round compilation is sized adaptively instead of being
      // squeezed into the 3-round 40–55s target.
      const nonPeaks = payload.speedRanges.filter((r) => !r.isPeak);
      assert.ok(nonPeaks.length > 0, 'Non-peak speed ranges must exist');
      for (const r of nonPeaks) {
        assert.ok(
          r.speed >= 2.5 && r.speed <= 3.5,
          `5 rounds base speed must stay in [2.50, 3.50], got ${r.speed}`,
        );
      }
      assert.ok(
        payload.totalPlaybackDurationMs >= 40000 && payload.totalPlaybackDurationMs <= 90000,
        `5 rounds adaptive playback duration out of range (got ${payload.totalPlaybackDurationMs}ms)`,
      );
    });
  });
});
