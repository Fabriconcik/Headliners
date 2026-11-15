import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReplayPayload,
  scrambleTickerText,
  type RecordedSegment,
} from '../server/replayAnalyzer.js';
import { TIMINGS } from '../shared/constants.js';
import type { ReplayEvent } from '../shared/protocol.js';

describe('Milestone 3: Unified Replay Engine', () => {
  // Helper to generate a full-length live segment (51,000ms raw)
  function makeFullSegment(
    idx: number,
    options?: {
      headline?: string;
      writerName?: string;
      events?: ReplayEvent[];
    },
  ): RecordedSegment {
    const rawDur = TIMINGS.SPLASH_MS + TIMINGS.LIVE_MS + TIMINGS.FREEZE_MS; // 51,000ms
    return {
      segmentIndex: idx,
      headline: options?.headline ?? `STORY HEADLINE ${idx + 1}`,
      writerName: options?.writerName ?? `Writer ${idx + 1}`,
      sourceDurationMs: rawDur,
      events: options?.events ?? [
        { t: 0, type: 'PHASE', phase: 'SPLASH' },
        { t: 3000, type: 'PHASE', phase: 'LIVE' },
        {
          t: 10000,
          type: 'REACTION',
          id: `r-${idx}-1`,
          emoji: '😂',
          lane: 0.25,
          senderId: 'saboteur-1',
        },
        {
          t: 10200,
          type: 'REACTION',
          id: `r-${idx}-2`,
          emoji: '👏',
          lane: 0.75,
          senderId: 'saboteur-2',
        },
        { t: 48000, type: 'PHASE', phase: 'FREEZE' },
      ],
    };
  }

  // =========================================================================
  // Category 1: Timeline Compression & Virtual Coordinates
  // =========================================================================
  describe('Category 1: Timeline Compression & Virtual Coordinates', () => {
    it('1.1 replay payload strictly excludes any PREP phase events', () => {
      const seg: RecordedSegment = {
        segmentIndex: 0,
        headline: 'PREP TEST',
        writerName: 'Writer 1',
        sourceDurationMs: 51000,
        events: [
          { t: -15000, type: 'PHASE', phase: 'PREP' },
          { t: -500, type: 'PHASE', phase: 'PREP' },
          { t: 0, type: 'PHASE', phase: 'SPLASH' },
          { t: 3000, type: 'PHASE', phase: 'LIVE' },
          {
            t: 5000,
            type: 'REACTION',
            id: 'r-1',
            emoji: '😂',
            lane: 0.5,
            senderId: 's1',
          },
          { t: 48000, type: 'PHASE', phase: 'FREEZE' },
        ],
      };

      const payload = buildReplayPayload([seg], Date.now());
      const hasPrep = payload.events.some(
        (e) => e.type === 'PHASE' && (e as any).phase === 'PREP',
      );
      assert.equal(hasPrep, false, 'Replay timeline must strictly exclude PREP phase events');

      const hasNegative = payload.events.some((e) => e.t < 0);
      assert.equal(hasNegative, false, 'Replay timeline must not contain negative timestamps');
    });

    it('1.2 compresses SPLASH live duration (3,000ms) to 1,200ms (0.4 * t_live)', () => {
      const seg: RecordedSegment = {
        segmentIndex: 0,
        headline: 'SPLASH COMPRESS',
        writerName: 'Writer 1',
        sourceDurationMs: 51000,
        events: [
          {
            t: 1000,
            type: 'REACTION',
            id: 'r-splash-1',
            emoji: '🔥',
            lane: 0.5,
            senderId: 's1',
          },
          {
            t: 2000,
            type: 'REACTION',
            id: 'r-splash-2',
            emoji: '🚀',
            lane: 0.5,
            senderId: 's1',
          },
        ],
      };

      const payload = buildReplayPayload([seg], Date.now());

      // Live 1000ms -> virtual Math.round(1000 * 0.4) = 400ms
      const ev1 = payload.events.find((e) => e.type === 'REACTION' && (e as any).id === 'r-splash-1');
      assert.ok(ev1, 'Event 1 must exist');
      assert.equal(ev1.t, 400, 't_live 1000ms must compress to 400ms');

      // Live 2000ms -> virtual Math.round(2000 * 0.4) = 800ms
      const ev2 = payload.events.find((e) => e.type === 'REACTION' && (e as any).id === 'r-splash-2');
      assert.ok(ev2, 'Event 2 must exist');
      assert.equal(ev2.t, 800, 't_live 2000ms must compress to 800ms');

      // Phase anchors
      const splashPhase = payload.events.find((e) => e.type === 'PHASE' && (e as any).phase === 'SPLASH');
      const livePhase = payload.events.find((e) => e.type === 'PHASE' && (e as any).phase === 'LIVE');
      assert.ok(splashPhase && livePhase);
      assert.equal(splashPhase.t, 0);
      assert.equal(livePhase.t, 1200);
    });

    it('1.3 retains full 45,000ms LIVE duration mapped 1:1 between 1,200ms and 46,200ms', () => {
      const seg: RecordedSegment = {
        segmentIndex: 0,
        headline: 'LIVE RETENTION',
        writerName: 'Writer 1',
        sourceDurationMs: 51000,
        events: [
          {
            t: 3000, // LIVE boundary
            type: 'REACTION',
            id: 'r-live-start',
            emoji: '✨',
            lane: 0.5,
            senderId: 's1',
          },
          {
            t: 10000,
            type: 'REACTION',
            id: 'r-live-mid',
            emoji: '🎉',
            lane: 0.5,
            senderId: 's1',
          },
          {
            t: 47999, // end of LIVE
            type: 'REACTION',
            id: 'r-live-end',
            emoji: '👋',
            lane: 0.5,
            senderId: 's1',
          },
        ],
      };

      const payload = buildReplayPayload([seg], Date.now());

      // 3000ms -> 1200 + (3000 - 3000) = 1200ms
      const evStart = payload.events.find((e) => (e as any).id === 'r-live-start');
      assert.equal(evStart?.t, 1200);

      // 10000ms -> 1200 + (10000 - 3000) = 8200ms
      const evMid = payload.events.find((e) => (e as any).id === 'r-live-mid');
      assert.equal(evMid?.t, 8200);

      // 47999ms -> 1200 + (47999 - 3000) = 46199ms
      const evEnd = payload.events.find((e) => (e as any).id === 'r-live-end');
      assert.equal(evEnd?.t, 46199);
    });

    it('1.4 compresses FREEZE live duration (3,000ms) to 1,000ms (46200 + (t_live - 48000)/3)', () => {
      const seg: RecordedSegment = {
        segmentIndex: 0,
        headline: 'FREEZE COMPRESS',
        writerName: 'Writer 1',
        sourceDurationMs: 51000,
        events: [
          {
            t: 48000,
            type: 'REACTION',
            id: 'r-frz-start',
            emoji: '🥶',
            lane: 0.5,
            senderId: 's1',
          },
          {
            t: 49500,
            type: 'REACTION',
            id: 'r-frz-mid',
            emoji: '📸',
            lane: 0.5,
            senderId: 's1',
          },
          {
            t: 51000,
            type: 'REACTION',
            id: 'r-frz-end',
            emoji: '🏁',
            lane: 0.5,
            senderId: 's1',
          },
        ],
      };

      const payload = buildReplayPayload([seg], Date.now());

      // 48000ms -> 46200ms
      const evStart = payload.events.find((e) => (e as any).id === 'r-frz-start');
      assert.equal(evStart?.t, 46200);

      // 49500ms -> 46200 + Math.round(1500 / 3) = 46700ms
      const evMid = payload.events.find((e) => (e as any).id === 'r-frz-mid');
      assert.equal(evMid?.t, 46700);

      // 51000ms -> 46200 + Math.round(3000 / 3) = 47200ms
      const evEnd = payload.events.find((e) => (e as any).id === 'r-frz-end');
      assert.equal(evEnd?.t, 47200);

      // Synthetic FREEZE phase anchor at 46200ms
      const freezePhase = payload.events.find((e) => e.type === 'PHASE' && (e as any).phase === 'FREEZE');
      assert.equal(freezePhase?.t, 46200);
    });

    it('1.5 single-segment compressed source duration is exactly 47,200ms (47.2s)', () => {
      const seg = makeFullSegment(0);
      const payload = buildReplayPayload([seg], Date.now());

      assert.equal(
        payload.totalSourceDurationMs,
        47200,
        `Expected 47200ms compressed source duration, got ${payload.totalSourceDurationMs}`,
      );
    });
  });

  // =========================================================================
  // Category 2: Multi-Segment Stitching & Global Offsets
  // =========================================================================
  describe('Category 2: Multi-Segment Stitching & Global Offsets', () => {
    it('2.1 stitches segments with global offset k * 47200 ms (N=3 => 141,600 ms)', () => {
      const segs = [makeFullSegment(0), makeFullSegment(1), makeFullSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      assert.equal(payload.totalSourceDurationMs, 3 * 47200);
      assert.equal(payload.totalSourceDurationMs, 141600);
    });

    it('2.2 emits synthetic SEGMENT_START event at k * 47200 ms for each segment with metadata', () => {
      const segs = [
        makeFullSegment(0, { headline: 'BREAKING ONE', writerName: 'Alice' }),
        makeFullSegment(1, { headline: 'SCANDAL TWO', writerName: 'Bob' }),
        makeFullSegment(2, { headline: 'FINALE THREE', writerName: 'Charlie' }),
      ];
      const payload = buildReplayPayload(segs, Date.now());

      const startEvents = payload.events.filter((e) => e.type === 'SEGMENT_START');
      assert.equal(startEvents.length, 3);

      assert.equal(startEvents[0].t, 0);
      assert.equal(startEvents[0].segmentIndex, 0);
      assert.equal(startEvents[0].headline, 'BREAKING ONE');
      assert.equal(startEvents[0].writerName, 'Alice');

      assert.equal(startEvents[1].t, 47200);
      assert.equal(startEvents[1].segmentIndex, 1);
      assert.equal(startEvents[1].headline, 'SCANDAL TWO');
      assert.equal(startEvents[1].writerName, 'Bob');

      assert.equal(startEvents[2].t, 94400);
      assert.equal(startEvents[2].segmentIndex, 2);
      assert.equal(startEvents[2].headline, 'FINALE THREE');
      assert.equal(startEvents[2].writerName, 'Charlie');
    });

    it('2.3 converts events across multiple segments to correct global virtual timestamps', () => {
      const segs = [
        makeFullSegment(0, {
          events: [
            {
              t: 10000,
              type: 'REACTION',
              id: 'r-s0',
              emoji: '😂',
              lane: 0.5,
              senderId: 'p1',
            },
          ],
        }),
        makeFullSegment(1, {
          events: [
            {
              t: 10000,
              type: 'REACTION',
              id: 'r-s1',
              emoji: '🔥',
              lane: 0.5,
              senderId: 'p2',
            },
          ],
        }),
      ];
      const payload = buildReplayPayload(segs, Date.now());

      // Seg 0 event: 0 + 1200 + (10000 - 3000) = 8200ms
      const ev0 = payload.events.find((e) => (e as any).id === 'r-s0');
      assert.equal(ev0?.t, 8200);

      // Seg 1 event: 47200 + 1200 + (10000 - 3000) = 47200 + 8200 = 55400ms
      const ev1 = payload.events.find((e) => (e as any).id === 'r-s1');
      assert.equal(ev1?.t, 55400);
    });

    it('2.4 stitches 4-segment match (188,800 ms) and 5-segment match (236,000 ms)', () => {
      const segs4 = [makeFullSegment(0), makeFullSegment(1), makeFullSegment(2), makeFullSegment(3)];
      const payload4 = buildReplayPayload(segs4, Date.now());
      assert.equal(payload4.totalSourceDurationMs, 4 * 47200);
      assert.equal(payload4.totalSourceDurationMs, 188800);

      const segs5 = [...segs4, makeFullSegment(4)];
      const payload5 = buildReplayPayload(segs5, Date.now());
      assert.equal(payload5.totalSourceDurationMs, 5 * 47200);
      assert.equal(payload5.totalSourceDurationMs, 236000);
    });
  });

  // =========================================================================
  // Category 3: Per-Round Peak Detection
  // =========================================================================
  describe('Category 3: Per-Round Peak Detection', () => {
    it('3.1 allocates strictly 1-2 peak windows per round (total in [3, 4] for N=3)', () => {
      const segs = [makeFullSegment(0), makeFullSegment(1), makeFullSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      const peaks = payload.speedRanges.filter((r) => r.isPeak);
      assert.ok(peaks.length >= 3, `Expected at least 3 peaks for 3 rounds, got ${peaks.length}`);
      assert.ok(peaks.length <= 4, `Expected at most 4 peaks for 3 rounds, got ${peaks.length}`);

      // Verify each round has at least one peak in its LIVE window
      for (let k = 0; k < 3; k++) {
        const liveStart = k * 47200 + 1200;
        const liveEnd = k * 47200 + 46200;
        const roundPeaks = peaks.filter((p) => p.startMs >= liveStart && p.endMs <= liveEnd);
        assert.ok(
          roundPeaks.length >= 1 && roundPeaks.length <= 2,
          `Round ${k} must have 1-2 peaks, got ${roundPeaks.length}`,
        );
      }
    });

    it('3.2 every peak window has an exact duration of 3,500ms', () => {
      const segs = [makeFullSegment(0), makeFullSegment(1), makeFullSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      const peaks = payload.speedRanges.filter((r) => r.isPeak);
      for (const p of peaks) {
        assert.equal(p.endMs - p.startMs, 3500, `Peak window duration must be 3500ms, got ${p.endMs - p.startMs}`);
      }
    });

    it('3.3 every peak window plays at speed 1.0x with isPeak === true', () => {
      const segs = [makeFullSegment(0), makeFullSegment(1), makeFullSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      const peaks = payload.speedRanges.filter((r) => r.isPeak);
      for (const p of peaks) {
        assert.equal(p.speed, 1.0, 'Peak window must play at 1.0x speed');
        assert.equal(p.isPeak, true, 'Peak window must have isPeak === true');
      }
    });

    it('3.4 all peak windows lie strictly within round LIVE duration [k*47200 + 1200, k*47200 + 46200]', () => {
      const segs = [makeFullSegment(0), makeFullSegment(1), makeFullSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      const peaks = payload.speedRanges.filter((r) => r.isPeak);
      for (const p of peaks) {
        const segIdx = Math.floor(p.startMs / 47200);
        const liveStart = segIdx * 47200 + 1200;
        const liveEnd = segIdx * 47200 + 46200;
        assert.ok(
          p.startMs >= liveStart,
          `Peak start ${p.startMs} must be >= liveStart ${liveStart}`,
        );
        assert.ok(
          p.endMs <= liveEnd,
          `Peak end ${p.endMs} must be <= liveEnd ${liveEnd}`,
        );
      }
    });

    it('3.5 peak windows within a round and across rounds never overlap', () => {
      const segs = [makeFullSegment(0), makeFullSegment(1), makeFullSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      const peaks = payload.speedRanges.filter((r) => r.isPeak);
      for (let i = 0; i < peaks.length - 1; i++) {
        assert.ok(
          peaks[i].endMs <= peaks[i + 1].startMs,
          `Peak ${i} [${peaks[i].startMs}, ${peaks[i].endMs}] overlaps with peak ${i + 1} [${peaks[i + 1].startMs}, ${peaks[i + 1].endMs}]`,
        );
      }
    });

    it('3.6 heat scoring centers peak window over reaction/sabotage clusters', () => {
      // Put a concentrated cluster of reactions at t_live = 20,000ms (virtual = 18,200ms)
      const events: ReplayEvent[] = [];
      for (let i = 0; i < 15; i++) {
        events.push({
          t: 20000 + i * 50,
          type: 'REACTION',
          id: `burst-${i}`,
          emoji: '😂',
          lane: 0.5,
          senderId: 's1',
        });
      }
      // Add sabotage visual (+5 heat)
      events.push({
        t: 20250,
        type: 'SABOTAGE_VISUAL',
        item: {
          id: 'sab-1',
          type: 'tomato',
          x: 0.5,
          y: 0.5,
          createdAt: Date.now(),
        },
      });

      const seg = makeFullSegment(0, { events });
      const payload = buildReplayPayload([seg], Date.now());

      const peaks = payload.speedRanges.filter((r) => r.isPeak);
      assert.ok(peaks.length >= 1);
      const primaryPeak = peaks[0];

      // Virtual timestamp of cluster center: 1200 + (20250 - 3000) = 18450ms
      assert.ok(
        primaryPeak.startMs <= 18450 && primaryPeak.endMs >= 18450,
        `Peak [${primaryPeak.startMs}, ${primaryPeak.endMs}] must cover the high-heat center (18450ms)`,
      );
    });

    it('3.7 two distinct separated activity clusters produce 2 distinct peak windows in that round', () => {
      const events: ReplayEvent[] = [];
      // Cluster A: around t_live = 10,000ms (virtual = 8,200ms)
      for (let i = 0; i < 8; i++) {
        events.push({
          t: 10000 + i * 50,
          type: 'REACTION',
          id: `cluster-a-${i}`,
          emoji: '🔥',
          lane: 0.2,
          senderId: 's1',
        });
      }

      // Cluster B: around t_live = 35,000ms (virtual = 33,200ms)
      events.push({
        t: 35000,
        type: 'SABOTAGE_FX',
        fx: {
          type: 'glitch',
          startedAt: Date.now(),
          expiresAt: Date.now() + 3000,
        },
      });
      for (let i = 0; i < 5; i++) {
        events.push({
          t: 35100 + i * 50,
          type: 'REACTION',
          id: `cluster-b-${i}`,
          emoji: '😱',
          lane: 0.8,
          senderId: 's2',
        });
      }

      const seg0 = makeFullSegment(0, { events });
      const seg1 = makeFullSegment(1, { events: [] });
      const seg2 = makeFullSegment(2, { events: [] });

      const payload = buildReplayPayload([seg0, seg1, seg2], Date.now());
      const peaks = payload.speedRanges.filter((r) => r.isPeak);

      // Total peaks should be 4 (2 in seg0, 1 in seg1, 1 in seg2)
      assert.equal(peaks.length, 4, `Expected exactly 4 peaks, got ${peaks.length}`);

      const seg0Peaks = peaks.filter((p) => p.startMs < 47200);
      assert.equal(seg0Peaks.length, 2, 'Seg 0 must receive 2 distinct peak windows');
      assert.ok(
        Math.abs(seg0Peaks[1].startMs - seg0Peaks[0].startMs) >= 3500,
        'Peaks in seg 0 must be non-overlapping',
      );
    });
  });

  // =========================================================================
  // Category 4: Dynamic Base Speed & Duration Invariance
  // =========================================================================
  describe('Category 4: Dynamic Base Speed & Duration Invariance', () => {
    it('4.1 base speed outside peaks is clamped between 2.50x and 3.50x for standard matches (N<=3)', () => {
      const segs = [makeFullSegment(0), makeFullSegment(1), makeFullSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      const nonPeaks = payload.speedRanges.filter((r) => !r.isPeak);
      assert.ok(nonPeaks.length > 0, 'Must contain non-peak speed ranges');
      for (const r of nonPeaks) {
        assert.ok(
          r.speed >= 2.5 && r.speed <= 3.5,
          `Base speed must be in [2.50, 3.50], got ${r.speed}`,
        );
      }
    });

    it('4.2 standard 3-segment match with zero events produces total duration strictly in [40000, 55000] ms', () => {
      const segs = [
        makeFullSegment(0, { events: [] }),
        makeFullSegment(1, { events: [] }),
        makeFullSegment(2, { events: [] }),
      ];
      const payload = buildReplayPayload(segs, Date.now());

      assert.ok(
        payload.totalPlaybackDurationMs >= 40000 && payload.totalPlaybackDurationMs <= 55000,
        `Duration must be in [40000, 55000] ms, got ${payload.totalPlaybackDurationMs}`,
      );
    });

    it('4.3 standard 3-segment match with dense events produces total duration strictly in [40000, 55000] ms', () => {
      const denseEvents: ReplayEvent[] = [];
      for (let i = 0; i < 100; i++) {
        denseEvents.push({
          t: 4000 + i * 400,
          type: 'REACTION',
          id: `r-${i}`,
          emoji: '😂',
          lane: (i % 5) / 5,
          senderId: 's1',
        });
      }

      const segs = [
        makeFullSegment(0, { events: denseEvents }),
        makeFullSegment(1, { events: denseEvents }),
        makeFullSegment(2, { events: denseEvents }),
      ];
      const payload = buildReplayPayload(segs, Date.now());

      assert.ok(
        payload.totalPlaybackDurationMs >= 40000 && payload.totalPlaybackDurationMs <= 55000,
        `Dense match duration must be in [40000, 55000] ms, got ${payload.totalPlaybackDurationMs}`,
      );
    });

    it('4.4 4-segment match (N=4) keeps base speed in [2.50, 3.50] and sizes adaptively', () => {
      const segs = [
        makeFullSegment(0),
        makeFullSegment(1),
        makeFullSegment(2),
        makeFullSegment(3),
      ];
      const payload = buildReplayPayload(segs, Date.now());

      const nonPeaks = payload.speedRanges.filter((r) => !r.isPeak);
      assert.ok(nonPeaks.length > 0, 'Non-peak ranges must exist');
      for (const r of nonPeaks) {
        assert.ok(
          r.speed >= 2.5 && r.speed <= 3.5,
          `4-segment base speed must stay in [2.50, 3.50], got ${r.speed}`,
        );
      }
      // Four 45s rounds cannot fit into 40–55s at <= 3.5x, therefore the length is
      // allowed to grow instead of forcing an unwatchable playback speed.
      assert.ok(
        payload.totalPlaybackDurationMs >= 40000 && payload.totalPlaybackDurationMs <= 90000,
        `4-segment adaptive duration out of range, got ${payload.totalPlaybackDurationMs}`,
      );
    });

    it('4.5 5-segment match (N=5) keeps base speed in [2.50, 3.50] and sizes adaptively', () => {
      const segs = [
        makeFullSegment(0),
        makeFullSegment(1),
        makeFullSegment(2),
        makeFullSegment(3),
        makeFullSegment(4),
      ];
      const payload = buildReplayPayload(segs, Date.now());

      const nonPeaks = payload.speedRanges.filter((r) => !r.isPeak);
      assert.ok(nonPeaks.length > 0, 'Non-peak ranges must exist');
      for (const r of nonPeaks) {
        assert.ok(
          r.speed >= 2.5 && r.speed <= 3.5,
          `5-segment base speed must stay in [2.50, 3.50], got ${r.speed}`,
        );
      }
      assert.ok(
        payload.totalPlaybackDurationMs >= 40000 && payload.totalPlaybackDurationMs <= 90000,
        `5-segment adaptive duration out of range, got ${payload.totalPlaybackDurationMs}`,
      );
    });

    it('4.6 totalPlaybackDurationMs matches exact interval calculation sum((end - start) / speed)', () => {
      const segs = [makeFullSegment(0), makeFullSegment(1), makeFullSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      const computed = Math.round(
        payload.speedRanges.reduce((acc, r) => acc + (r.endMs - r.startMs) / r.speed, 0),
      );
      assert.equal(payload.totalPlaybackDurationMs, computed);
    });
  });

  // =========================================================================
  // Category 5: Speed Ranges Partition & Contiguity Coverage
  // =========================================================================
  describe('Category 5: Speed Ranges Partition & Contiguity Coverage', () => {
    it('5.1 starts at 0 and ends at totalSourceDurationMs', () => {
      const segs = [makeFullSegment(0), makeFullSegment(1), makeFullSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      assert.equal(payload.speedRanges[0].startMs, 0);
      assert.equal(
        payload.speedRanges[payload.speedRanges.length - 1].endMs,
        payload.totalSourceDurationMs,
      );
    });

    it('5.2 forms contiguous partition with zero gaps and zero overlaps', () => {
      const segs = [makeFullSegment(0), makeFullSegment(1), makeFullSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      for (let i = 0; i < payload.speedRanges.length - 1; i++) {
        const curr = payload.speedRanges[i];
        const next = payload.speedRanges[i + 1];
        assert.equal(
          curr.endMs,
          next.startMs,
          `Range ${i} endMs (${curr.endMs}) must strictly equal range ${i + 1} startMs (${next.startMs})`,
        );
      }
    });

    it('5.3 speed ranges strictly partition between peak (1.0x) and non-peak (baseSpeed)', () => {
      const segs = [makeFullSegment(0), makeFullSegment(1), makeFullSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      const nonPeaks = payload.speedRanges.filter((r) => !r.isPeak);
      assert.ok(nonPeaks.length > 0);
      const expectedBaseSpeed = nonPeaks[0].speed;

      for (const r of payload.speedRanges) {
        if (r.isPeak) {
          assert.equal(r.speed, 1.0);
        } else {
          assert.equal(r.speed, expectedBaseSpeed);
        }
      }
    });
  });

  // =========================================================================
  // Category 6: Event Synchronization & Chronological Ordering
  // =========================================================================
  describe('Category 6: Event Synchronization & Chronological Ordering', () => {
    it('6.1 event stream in ReplayPayload.events is strictly sorted by non-decreasing timestamp t', () => {
      const segs = [
        makeFullSegment(0),
        makeFullSegment(1),
        makeFullSegment(2),
      ];
      const payload = buildReplayPayload(segs, Date.now());

      for (let i = 0; i < payload.events.length - 1; i++) {
        assert.ok(
          payload.events[i].t <= payload.events[i + 1].t,
          `Event ${i} (t=${payload.events[i].t}) must precede or match event ${i + 1} (t=${payload.events[i + 1].t})`,
        );
      }
    });

    it('6.2 preserves and accurately maps all event types into replay timeline', () => {
      const diverseEvents: ReplayEvent[] = [
        {
          t: 4000,
          type: 'STROKE_ADD',
          stroke: {
            id: 'strk-1',
            artistId: 'a1',
            color: '#FF0000',
            widthNorm: 0.02,
            pts: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
          },
        },
        {
          t: 4500,
          type: 'STROKE_UPDATE',
          strokeId: 'strk-1',
          pts: [{ x: 0.3, y: 0.3 }],
        },
        {
          t: 5000,
          type: 'STAMP_ADD',
          stamp: {
            id: 'stmp-1',
            artistId: 'a1',
            stampId: 'star',
            color: '#FFFF00',
            x: 0.5,
            y: 0.5,
          },
        },
        {
          t: 6000,
          type: 'UNDO_ITEM',
          id: 'stmp-1',
        },
        {
          t: 7000,
          type: 'WIPERS',
          artistName: 'BobArtist',
        },
        {
          t: 8000,
          type: 'SABOTAGE_VISUAL',
          item: {
            id: 'sab-vis-1',
            type: 'sticker',
            x: 0.4,
            y: 0.4,
            createdAt: Date.now(),
          },
        },
        {
          t: 9000,
          type: 'SABOTAGE_FX',
          fx: {
            type: 'flip',
            startedAt: Date.now(),
            expiresAt: Date.now() + 4000,
          },
        },
        {
          t: 10000,
          type: 'TICKER_ADD',
          item: {
            id: 'tick-1',
            text: 'Live breaking fact',
            writerName: 'Writer 1',
          },
        },
        {
          t: 11000,
          type: 'TICKER_HACK',
          originalText: 'Original text',
          hackedText: 'H@ck3d text',
        },
        {
          t: 12000,
          type: 'REACTION',
          id: 'rxn-1',
          emoji: '🤡',
          lane: 0.6,
          senderId: 's1',
        },
      ];

      const seg = makeFullSegment(0, { events: diverseEvents });
      const payload = buildReplayPayload([seg], Date.now());

      const eventTypes = new Set(payload.events.map((e) => e.type));
      assert.ok(eventTypes.has('SEGMENT_START'));
      assert.ok(eventTypes.has('PHASE'));
      assert.ok(eventTypes.has('STROKE_ADD'));
      assert.ok(eventTypes.has('STROKE_UPDATE'));
      assert.ok(eventTypes.has('STAMP_ADD'));
      assert.ok(eventTypes.has('UNDO_ITEM'));
      assert.ok(eventTypes.has('WIPERS'));
      assert.ok(eventTypes.has('SABOTAGE_VISUAL'));
      assert.ok(eventTypes.has('SABOTAGE_FX'));
      assert.ok(eventTypes.has('TICKER_ADD'));
      assert.ok(eventTypes.has('TICKER_HACK'));
      assert.ok(eventTypes.has('REACTION'));
    });

    it('6.3 REACTION events preserve emoji, lane, and sender identifier', () => {
      const seg = makeFullSegment(0, {
        events: [
          {
            t: 8000,
            type: 'REACTION',
            id: 'custom-emoji-test',
            emoji: '🦾',
            lane: 0.88,
            senderId: 'sab-special',
          },
        ],
      });
      const payload = buildReplayPayload([seg], Date.now());

      const rxn = payload.events.find((e) => (e as any).id === 'custom-emoji-test') as any;
      assert.ok(rxn, 'Reaction must exist in replay payload');
      assert.equal(rxn.emoji, '🦾');
      assert.equal(rxn.lane, 0.88);
      assert.equal(rxn.senderId, 'sab-special');
    });
  });

  // =========================================================================
  // Category 7: Edge Cases & Numerical Robustness
  // =========================================================================
  describe('Category 7: Edge Cases & Numerical Robustness', () => {
    it('7.1 zero events in all rounds computes valid payload without NaN with 1 safe default peak window per round', () => {
      const segs = [
        makeFullSegment(0, { events: [] }),
        makeFullSegment(1, { events: [] }),
        makeFullSegment(2, { events: [] }),
      ];
      const payload = buildReplayPayload(segs, Date.now());

      assert.equal(Number.isNaN(payload.totalPlaybackDurationMs), false);
      assert.ok(payload.totalPlaybackDurationMs > 0);

      const peaks = payload.speedRanges.filter((r) => r.isPeak);
      assert.equal(peaks.length, 3, 'Zero events match must allocate exactly 1 default peak per round');

      for (const r of payload.speedRanges) {
        assert.equal(Number.isNaN(r.speed), false);
        assert.equal(Number.isNaN(r.startMs), false);
        assert.equal(Number.isNaN(r.endMs), false);
      }
    });

    it('7.2 all events clustered in a 1-second burst correctly centers the 3.5s peak window', () => {
      const events: ReplayEvent[] = [];
      // 30 emojis between 15000ms and 16000ms live (virtual: 13200ms to 14200ms)
      for (let i = 0; i < 30; i++) {
        events.push({
          t: 15000 + i * 30,
          type: 'REACTION',
          id: `cluster-1s-${i}`,
          emoji: '🔥',
          lane: 0.5,
          senderId: 's1',
        });
      }

      const seg = makeFullSegment(0, { events });
      const payload = buildReplayPayload([seg], Date.now());

      const peaks = payload.speedRanges.filter((r) => r.isPeak);
      assert.ok(peaks.length >= 1);
      const peak = peaks[0];

      // Virtual cluster center: 1200 + (15500 - 3000) = 13700ms
      assert.ok(
        peak.startMs <= 13700 && peak.endMs >= 13700,
        `Peak [${peak.startMs}, ${peak.endMs}] must encompass virtual cluster center (13700ms)`,
      );
    });

    it('7.3 extreme event burst (600+ events) runs efficiently without performance degradation', () => {
      const burstEvents: ReplayEvent[] = [];
      for (let i = 0; i < 600; i++) {
        burstEvents.push({
          t: 3000 + (i % 45000),
          type: 'REACTION',
          id: `burst-extreme-${i}`,
          emoji: '😂',
          lane: Math.random(),
          senderId: `p-${i % 4}`,
        });
      }

      const segs = [
        makeFullSegment(0, { events: burstEvents }),
        makeFullSegment(1, { events: burstEvents }),
        makeFullSegment(2, { events: burstEvents }),
      ];

      const t0 = performance.now();
      const payload = buildReplayPayload(segs, Date.now());
      const elapsed = performance.now() - t0;

      assert.ok(elapsed < 200, `Replay compilation took ${elapsed.toFixed(1)}ms (expected < 200ms)`);
      assert.ok(payload.events.length >= 1800);
      assert.ok(payload.totalPlaybackDurationMs >= 40000 && payload.totalPlaybackDurationMs <= 55000);
    });

    it('7.4 numerical precision: all timestamps and durations are integer values', () => {
      const segs = [makeFullSegment(0), makeFullSegment(1), makeFullSegment(2)];
      const payload = buildReplayPayload(segs, Date.now());

      assert.ok(Number.isInteger(payload.totalSourceDurationMs));
      assert.ok(Number.isInteger(payload.totalPlaybackDurationMs));

      for (const r of payload.speedRanges) {
        assert.ok(Number.isInteger(r.startMs));
        assert.ok(Number.isInteger(r.endMs));
      }

      for (const ev of payload.events) {
        assert.ok(Number.isInteger(ev.t));
      }
    });

    it('7.5 boundary timestamps (0, 3000, 48000, 51000) map without off-by-one errors', () => {
      const seg = makeFullSegment(0, {
        events: [
          { t: 0, type: 'REACTION', id: 'b-0', emoji: '0️⃣', lane: 0.1, senderId: 's1' },
          { t: 3000, type: 'REACTION', id: 'b-3000', emoji: '3️⃣', lane: 0.2, senderId: 's1' },
          { t: 48000, type: 'REACTION', id: 'b-48000', emoji: '4️⃣', lane: 0.3, senderId: 's1' },
          { t: 51000, type: 'REACTION', id: 'b-51000', emoji: '5️⃣', lane: 0.4, senderId: 's1' },
        ],
      });
      const payload = buildReplayPayload([seg], Date.now());

      const e0 = payload.events.find((e) => (e as any).id === 'b-0');
      const e3k = payload.events.find((e) => (e as any).id === 'b-3000');
      const e48k = payload.events.find((e) => (e as any).id === 'b-48000');
      const e51k = payload.events.find((e) => (e as any).id === 'b-51000');

      assert.equal(e0?.t, 0);
      assert.equal(e3k?.t, 1200);
      assert.equal(e48k?.t, 46200);
      assert.equal(e51k?.t, 47200);
    });

    it('7.6 scrambleTickerText glitched output check', () => {
      const original = 'BREAKING NEWS: CITY POLICE ARREST NOTORIOUS CYBER ROBBER';
      const scrambled = scrambleTickerText(original);
      assert.equal(typeof scrambled, 'string');
      assert.ok(scrambled.length > 0);
    });
  });
});
