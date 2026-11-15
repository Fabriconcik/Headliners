import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReplayPayload,
  scrambleTickerText,
  type RecordedSegment,
} from '../server/replayAnalyzer.js';
import { TIMINGS } from '../shared/constants.js';
import type { ReplayEvent, ReplaySpeedRange } from '../shared/protocol.js';

describe('Empirical Adversarial Stress Suite: Replay Math & Boundary (Milestone 3)', () => {
  // PRNG helper with seed for deterministic reproducibility
  function createPrng(seed: number) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  const EVENT_TYPES = [
    'REACTION',
    'SABOTAGE_VISUAL',
    'SABOTAGE_FX',
    'TICKER_HACK',
    'TICKER_ADD',
    'WIPERS',
    'STAMP_ADD',
    'UNDO_ITEM',
    'STROKE_ADD',
  ] as const;

  function generateRandomSegment(
    segIdx: number,
    eventCount: number,
    rand: () => number,
    options?: {
      forceBurst?: boolean;
      burstCenterMs?: number;
      includePrepAndNegative?: boolean;
    },
  ): RecordedSegment {
    const rawFullDuration = TIMINGS.SPLASH_MS + TIMINGS.LIVE_MS + TIMINGS.FREEZE_MS; // 51,000ms
    const events: ReplayEvent[] = [];

    if (options?.includePrepAndNegative) {
      events.push({ t: -15000, type: 'PHASE', phase: 'PREP' });
      events.push({ t: -250, type: 'PHASE', phase: 'PREP' });
      events.push({
        t: -100,
        type: 'REACTION',
        id: `neg-${segIdx}`,
        emoji: '⚠️',
        lane: 0.5,
        senderId: 'bad',
      } as any);
    }

    events.push({ t: 0, type: 'PHASE', phase: 'SPLASH' });
    events.push({ t: 3000, type: 'PHASE', phase: 'LIVE' });

    for (let i = 0; i < eventCount; i++) {
      let t: number;
      if (options?.forceBurst && options?.burstCenterMs !== undefined) {
        // Clustered around burstCenterMs +/- 500ms
        t = Math.max(3000, Math.min(48000, Math.round(options.burstCenterMs + (rand() - 0.5) * 1000)));
      } else {
        // Distributed across segment, with occasional SPLASH or FREEZE events
        const roll = rand();
        if (roll < 0.05) {
          t = Math.floor(rand() * 3000); // SPLASH
        } else if (roll < 0.95) {
          t = 3000 + Math.floor(rand() * 45000); // LIVE
        } else {
          t = 48000 + Math.floor(rand() * 3000); // FREEZE
        }
      }

      const type = EVENT_TYPES[Math.floor(rand() * EVENT_TYPES.length)];
      switch (type) {
        case 'REACTION':
          events.push({
            t,
            type: 'REACTION',
            id: `rx-${segIdx}-${i}`,
            emoji: rand() < 0.5 ? '😂' : '🔥',
            lane: rand(),
            senderId: `sab-${segIdx}-${i % 3}`,
          });
          break;
        case 'SABOTAGE_VISUAL':
          events.push({
            t,
            type: 'SABOTAGE_VISUAL',
            item: {
              id: `sab-vis-${segIdx}-${i}`,
              type: 'tomato',
              x: rand(),
              y: rand(),
              createdAt: Date.now(),
            },
          });
          break;
        case 'SABOTAGE_FX':
          events.push({
            t,
            type: 'SABOTAGE_FX',
            fx: {
              type: rand() < 0.5 ? 'glitch' : 'flip',
              startedAt: Date.now(),
              expiresAt: Date.now() + 3000,
            },
          });
          break;
        case 'TICKER_HACK':
          events.push({
            t,
            type: 'TICKER_HACK',
            originalText: 'News headline',
            hackedText: 'N3ws h@ck3d',
          });
          break;
        case 'WIPERS':
          events.push({
            t,
            type: 'WIPERS',
            artistName: `Artist${i % 2}`,
          });
          break;
        case 'STAMP_ADD':
          events.push({
            t,
            type: 'STAMP_ADD',
            stamp: {
              id: `st-${segIdx}-${i}`,
              artistId: `art-${segIdx}`,
              stampId: 'star',
              color: '#FF0000',
              x: rand(),
              y: rand(),
            },
          });
          break;
        case 'UNDO_ITEM':
          events.push({
            t,
            type: 'UNDO_ITEM',
            id: `st-${segIdx}-${Math.max(0, i - 1)}`,
          });
          break;
        default:
          events.push({
            t,
            type: 'REACTION',
            id: `def-rx-${segIdx}-${i}`,
            emoji: '👏',
            lane: 0.5,
            senderId: 'spectator',
          });
          break;
      }
    }

    events.push({ t: 48000, type: 'PHASE', phase: 'FREEZE' });

    return {
      segmentIndex: segIdx,
      headline: `HEADLINE SEGMENT ${segIdx}`,
      writerName: `Writer ${segIdx}`,
      sourceDurationMs: rawFullDuration,
      events,
    };
  }

  // Common verification oracle for all 7 invariants
  function verifyReplayInvariants(
    payload: ReturnType<typeof buildReplayPayload>,
    N: number,
    contextInfo: string,
  ) {
    const { speedRanges, totalSourceDurationMs, totalPlaybackDurationMs, events } = payload;

    // Numerical sanity checks: no NaNs, no Infinities, integers where expected
    assert.ok(!Number.isNaN(totalSourceDurationMs), `${contextInfo}: totalSourceDurationMs is NaN`);
    assert.ok(!Number.isNaN(totalPlaybackDurationMs), `${contextInfo}: totalPlaybackDurationMs is NaN`);
    assert.ok(Number.isFinite(totalPlaybackDurationMs), `${contextInfo}: totalPlaybackDurationMs not finite`);
    assert.ok(Number.isInteger(totalSourceDurationMs), `${contextInfo}: totalSourceDurationMs not integer`);
    assert.ok(Number.isInteger(totalPlaybackDurationMs), `${contextInfo}: totalPlaybackDurationMs not integer`);

    // Invariant 4: Speed ranges MUST form a contiguous partition covering [0, totalSourceDurationMs]
    // with r[i].endMs === r[i+1].startMs, with 0 gaps and 0 overlaps.
    assert.ok(speedRanges.length > 0, `${contextInfo}: speedRanges is empty`);
    assert.equal(speedRanges[0].startMs, 0, `${contextInfo}: first speed range startMs must be 0`);
    assert.equal(
      speedRanges[speedRanges.length - 1].endMs,
      totalSourceDurationMs,
      `${contextInfo}: last speed range endMs (${speedRanges[speedRanges.length - 1].endMs}) must match totalSourceDurationMs (${totalSourceDurationMs})`,
    );

    for (let i = 0; i < speedRanges.length - 1; i++) {
      const cur = speedRanges[i];
      const next = speedRanges[i + 1];
      assert.equal(
        cur.endMs,
        next.startMs,
        `${contextInfo}: Gap/overlap detected between range ${i} [${cur.startMs}, ${cur.endMs}] and range ${i + 1} [${next.startMs}, ${next.endMs}]`,
      );
      assert.ok(cur.endMs > cur.startMs, `${contextInfo}: range ${i} duration <= 0`);
    }

    const peaks = speedRanges.filter((r) => r.isPeak);
    const nonPeaks = speedRanges.filter((r) => !r.isPeak);

    // Invariant 3: Peak speeds MUST all equal 1.0x with isPeak: true
    for (const p of peaks) {
      assert.equal(p.speed, 1.0, `${contextInfo}: peak speed must be 1.0, got ${p.speed}`);
      assert.equal(p.isPeak, true, `${contextInfo}: peak range must have isPeak: true`);
      assert.ok(Number.isInteger(p.startMs), `${contextInfo}: peak startMs not integer`);
      assert.ok(Number.isInteger(p.endMs), `${contextInfo}: peak endMs not integer`);
    }

    // Invariant 5: No peak windows may overlap (p_1.endMs <= p_2.startMs)
    for (let i = 0; i < peaks.length - 1; i++) {
      assert.ok(
        peaks[i].endMs <= peaks[i + 1].startMs,
        `${contextInfo}: Peaks overlap: peak ${i} end ${peaks[i].endMs} > peak ${i + 1} start ${peaks[i + 1].startMs}`,
      );
    }

    // Invariant 6: All peak windows MUST lie strictly within the round's LIVE window
    // For full-length rounds: round k live window is [k*47200 + 1200, k*47200 + 46200]
    for (const p of peaks) {
      const roundIdx = Math.floor(p.startMs / 47200);
      const liveStart = roundIdx * 47200 + 1200;
      const liveEnd = roundIdx * 47200 + 46200;
      assert.ok(
        p.startMs >= liveStart,
        `${contextInfo}: Peak startMs ${p.startMs} before round ${roundIdx} liveStart ${liveStart}`,
      );
      assert.ok(
        p.endMs <= liveEnd,
        `${contextInfo}: Peak endMs ${p.endMs} after round ${roundIdx} liveEnd ${liveEnd}`,
      );
      assert.equal(p.endMs - p.startMs, 3500, `${contextInfo}: Peak duration must be exactly 3500ms`);
    }

    // Invariant 2: Base speed MUST stay strictly within [2.50, 3.50] for every N
    // (a real room has N = 3; N > 3 only happens in test mode, and an accelerated
    // 5x–33x replay would be unwatchable).
    if (nonPeaks.length > 0) {
      for (const np of nonPeaks) {
        assert.ok(
          np.speed >= 2.50 && np.speed <= 3.50,
          `${contextInfo}: Base speed ${np.speed} out of [2.50, 3.50] for N=${N}`,
        );
      }
    }

    // Invariant 1: For the production shape (N = 3) the total playback duration MUST be
    // strictly within [40000, 55000] ms. For N > 3 the duration grows adaptively so the
    // 2.5x–3.5x speed band is preserved, hence only the lower bound is asserted.
    if (N === 3) {
      assert.ok(
        totalPlaybackDurationMs >= 40000 && totalPlaybackDurationMs <= 55000,
        `${contextInfo}: Total playback duration ${totalPlaybackDurationMs} ms outside [40000, 55000] ms for N=${N}`,
      );
    } else if (N > 3) {
      assert.ok(
        totalPlaybackDurationMs >= 40000,
        `${contextInfo}: Adaptive playback duration ${totalPlaybackDurationMs} ms below 40000 ms for N=${N}`,
      );
    }

    // Invariant 7: Duration calculation formula sum((r.endMs - r.startMs) / r.speed) must match totalPlaybackDurationMs (within rounding tolerance)
    const exactSum = speedRanges.reduce((acc, r) => acc + (r.endMs - r.startMs) / r.speed, 0);
    const diff = Math.abs(exactSum - totalPlaybackDurationMs);
    assert.ok(
      diff <= 1.0,
      `${contextInfo}: Duration formula sum ${exactSum} deviates from totalPlaybackDurationMs ${totalPlaybackDurationMs} by ${diff} (exceeds 1.0ms)`,
    );

    // Event sequence validation: strictly non-decreasing timestamps, no PREP, no negative
    for (let i = 0; i < events.length - 1; i++) {
      assert.ok(
        events[i].t <= events[i + 1].t,
        `${contextInfo}: Events out of order at index ${i}: ${events[i].t} > ${events[i + 1].t}`,
      );
    }
    const hasPrep = events.some((e) => e.type === 'PHASE' && (e as any).phase === 'PREP');
    assert.equal(hasPrep, false, `${contextInfo}: Payload contains PREP event`);
    const hasNegative = events.some((e) => e.t < 0);
    assert.equal(hasNegative, false, `${contextInfo}: Payload contains negative event timestamp`);
  }

  // =========================================================================
  // Suite 1: Monte Carlo Simulation (120+ Randomized Match Topologies)
  // =========================================================================
  describe('Suite 1: Monte Carlo Simulation (120+ Topologies across N in [1, 2, 3, 4, 5, 6, 8, 10])', () => {
    it('1.1 executes 120 Monte Carlo iterations with randomized event counts (0..1000) and topologies', () => {
      const rand = createPrng(421337);
      const N_VALUES = [1, 2, 3, 4, 5, 6, 8, 10];
      let totalRuns = 0;

      for (let run = 0; run < 120; run++) {
        // Pick N from distribution weighted toward realistic matches (3, 4, 5) but covering all
        const N = run < 60
          ? N_VALUES[2 + (run % 3)] // N in [3, 4, 5] (60 runs)
          : N_VALUES[Math.floor(rand() * N_VALUES.length)]; // N in [1, 2, 3, 4, 5, 6, 8, 10] (60 runs)

        const segments: RecordedSegment[] = [];
        for (let k = 0; k < N; k++) {
          // Event counts from 0 to 1000, with varied topologies (sparse, moderate, bursty, extreme)
          let eventCount: number;
          const style = rand();
          if (style < 0.15) {
            eventCount = 0; // completely quiet round
          } else if (style < 0.35) {
            eventCount = Math.floor(rand() * 15); // sparse
          } else if (style < 0.70) {
            eventCount = 20 + Math.floor(rand() * 100); // moderate
          } else if (style < 0.90) {
            eventCount = 100 + Math.floor(rand() * 400); // heavy
          } else {
            eventCount = 500 + Math.floor(rand() * 501); // extreme (up to 1000)
          }

          const hasBurst = rand() < 0.4;
          const burstCenterMs = 5000 + Math.floor(rand() * 40000);
          segments.push(
            generateRandomSegment(k, eventCount, rand, {
              forceBurst: hasBurst,
              burstCenterMs,
              includePrepAndNegative: rand() < 0.3,
            }),
          );
        }

        const payload = buildReplayPayload(segments, Date.now() + run * 1000);
        verifyReplayInvariants(payload, N, `MonteCarlo_Run_${run}_N_${N}`);
        totalRuns++;
      }

      assert.equal(totalRuns, 120, 'Must complete exactly 120 Monte Carlo runs');
    });
  });

  // =========================================================================
  // Suite 2: Invariant 1 — Duration for N=3 and adaptive sizing for N > 3
  // =========================================================================
  describe('Suite 2: Invariant 1 — Playback Duration (N=3) and adaptive sizing (N>3)', () => {
    it('2.1 verifies duration bounds for N=3 across zero, low, medium, high, and extreme event loads', () => {
      const rand = createPrng(1001);
      const loads = [0, 5, 50, 200, 600, 1000];

      for (const count of loads) {
        const segs = [
          generateRandomSegment(0, count, rand),
          generateRandomSegment(1, count, rand),
          generateRandomSegment(2, count, rand),
        ];
        const payload = buildReplayPayload(segs, Date.now());
        assert.ok(
          payload.totalPlaybackDurationMs >= 40000 && payload.totalPlaybackDurationMs <= 55000,
          `N=3 count=${count}: duration ${payload.totalPlaybackDurationMs} ms not in [40000, 55000]`,
        );
        verifyReplayInvariants(payload, 3, `Invariant1_N3_Count_${count}`);
      }
    });

    it('2.2 keeps N=4 base speed in [2.50, 3.50] and sizes the duration adaptively', () => {
      const rand = createPrng(1002);
      const loads = [0, 5, 50, 200, 600, 1000];

      for (const count of loads) {
        const segs = [
          generateRandomSegment(0, count, rand),
          generateRandomSegment(1, count, rand),
          generateRandomSegment(2, count, rand),
          generateRandomSegment(3, count, rand),
        ];
        const payload = buildReplayPayload(segs, Date.now());
        const nonPeaks = payload.speedRanges.filter((r) => !r.isPeak);
        assert.ok(nonPeaks.length > 0, `N=4 count=${count}: no non-peak ranges`);
        for (const np of nonPeaks) {
          assert.ok(
            np.speed >= 2.5 && np.speed <= 3.5,
            `N=4 count=${count}: base speed ${np.speed} out of [2.50, 3.50]`,
          );
        }
        assert.ok(
          payload.totalPlaybackDurationMs >= 40000 && payload.totalPlaybackDurationMs <= 90000,
          `N=4 count=${count}: adaptive duration ${payload.totalPlaybackDurationMs} ms out of [40000, 90000]`,
        );
        verifyReplayInvariants(payload, 4, `Invariant1_N4_Count_${count}`);
      }
    });

    it('2.3 keeps N=5 base speed in [2.50, 3.50] and sizes the duration adaptively', () => {
      const rand = createPrng(1003);
      const loads = [0, 5, 50, 200, 600, 1000];

      for (const count of loads) {
        const segs = [
          generateRandomSegment(0, count, rand),
          generateRandomSegment(1, count, rand),
          generateRandomSegment(2, count, rand),
          generateRandomSegment(3, count, rand),
          generateRandomSegment(4, count, rand),
        ];
        const payload = buildReplayPayload(segs, Date.now());
        const nonPeaks = payload.speedRanges.filter((r) => !r.isPeak);
        assert.ok(nonPeaks.length > 0, `N=5 count=${count}: no non-peak ranges`);
        for (const np of nonPeaks) {
          assert.ok(
            np.speed >= 2.5 && np.speed <= 3.5,
            `N=5 count=${count}: base speed ${np.speed} out of [2.50, 3.50]`,
          );
        }
        assert.ok(
          payload.totalPlaybackDurationMs >= 40000 && payload.totalPlaybackDurationMs <= 90000,
          `N=5 count=${count}: adaptive duration ${payload.totalPlaybackDurationMs} ms out of [40000, 90000]`,
        );
        verifyReplayInvariants(payload, 5, `Invariant1_N5_Count_${count}`);
      }
    });

    it('2.4 asymmetric match: one round with 1,000 events and two rounds with 0 events', () => {
      const rand = createPrng(1004);
      const segs = [
        generateRandomSegment(0, 1000, rand),
        generateRandomSegment(1, 0, rand),
        generateRandomSegment(2, 0, rand),
      ];
      const payload = buildReplayPayload(segs, Date.now());
      assert.ok(
        payload.totalPlaybackDurationMs >= 40000 && payload.totalPlaybackDurationMs <= 55000,
        `Asymmetric N=3: duration ${payload.totalPlaybackDurationMs} ms not in [40000, 55000]`,
      );
      verifyReplayInvariants(payload, 3, 'Invariant1_Asymmetric_N3');
    });
  });

  // =========================================================================
  // Suite 3: Invariant 2 — Base Speed Clamped in [2.50, 3.50] for N <= 3
  // =========================================================================
  describe('Suite 3: Invariant 2 — Base Speed Clamp in [2.50, 3.50] for N <= 3', () => {
    it('3.1 N=1 base speed is strictly clamped within [2.50, 3.50]', () => {
      const rand = createPrng(2001);
      const seg = generateRandomSegment(0, 100, rand);
      const payload = buildReplayPayload([seg], Date.now());

      const nonPeaks = payload.speedRanges.filter((r) => !r.isPeak);
      assert.ok(nonPeaks.length > 0);
      for (const np of nonPeaks) {
        assert.ok(
          np.speed >= 2.50 && np.speed <= 3.50,
          `N=1: Base speed ${np.speed} must be in [2.50, 3.50]`,
        );
      }
    });

    it('3.2 N=2 base speed is strictly clamped within [2.50, 3.50]', () => {
      const rand = createPrng(2002);
      const segs = [generateRandomSegment(0, 50, rand), generateRandomSegment(1, 150, rand)];
      const payload = buildReplayPayload(segs, Date.now());

      const nonPeaks = payload.speedRanges.filter((r) => !r.isPeak);
      assert.ok(nonPeaks.length > 0);
      for (const np of nonPeaks) {
        assert.ok(
          np.speed >= 2.50 && np.speed <= 3.50,
          `N=2: Base speed ${np.speed} must be in [2.50, 3.50]`,
        );
      }
    });

    it('3.3 N=3 base speed is strictly clamped within [2.50, 3.50] across varied event distributions', () => {
      const rand = createPrng(2003);
      for (let i = 0; i < 20; i++) {
        const segs = [
          generateRandomSegment(0, Math.floor(rand() * 200), rand),
          generateRandomSegment(1, Math.floor(rand() * 200), rand),
          generateRandomSegment(2, Math.floor(rand() * 200), rand),
        ];
        const payload = buildReplayPayload(segs, Date.now());
        const nonPeaks = payload.speedRanges.filter((r) => !r.isPeak);
        for (const np of nonPeaks) {
          assert.ok(
            np.speed >= 2.50 && np.speed <= 3.50,
            `N=3 iter ${i}: Base speed ${np.speed} out of [2.50, 3.50]`,
          );
        }
      }
    });
  });

  // =========================================================================
  // Suite 4: Invariants 3 & 4 — Peak Speeds 1.0x & Contiguous Speed Partition
  // =========================================================================
  describe('Suite 4: Invariants 3 & 4 — Peak Speeds 1.0x & Contiguous Partition Coverage', () => {
    it('4.1 peak speeds strictly equal 1.0 with isPeak: true and exact 3500ms duration', () => {
      const rand = createPrng(3001);
      const segs = [
        generateRandomSegment(0, 100, rand),
        generateRandomSegment(1, 100, rand),
        generateRandomSegment(2, 100, rand),
      ];
      const payload = buildReplayPayload(segs, Date.now());

      const peaks = payload.speedRanges.filter((r) => r.isPeak);
      assert.ok(peaks.length >= 3);
      for (const p of peaks) {
        assert.equal(p.speed, 1.0);
        assert.equal(p.isPeak, true);
        assert.equal(p.endMs - p.startMs, 3500);
      }
    });

    it('4.2 partition coverage starts at 0, ends at totalSourceDurationMs with 0 gaps/overlaps', () => {
      const rand = createPrng(3002);
      const segs = [
        generateRandomSegment(0, 300, rand),
        generateRandomSegment(1, 300, rand),
        generateRandomSegment(2, 300, rand),
        generateRandomSegment(3, 300, rand),
      ];
      const payload = buildReplayPayload(segs, Date.now());

      assert.equal(payload.speedRanges[0].startMs, 0);
      assert.equal(
        payload.speedRanges[payload.speedRanges.length - 1].endMs,
        payload.totalSourceDurationMs,
      );

      for (let i = 0; i < payload.speedRanges.length - 1; i++) {
        const cur = payload.speedRanges[i];
        const next = payload.speedRanges[i + 1];
        assert.equal(
          cur.endMs,
          next.startMs,
          `Range ${i} [${cur.startMs}, ${cur.endMs}] does not connect to range ${i + 1} [${next.startMs}, ${next.endMs}]`,
        );
      }
    });
  });

  // =========================================================================
  // Suite 5: Invariants 5 & 6 — Peak Windows Non-Overlapping & Within LIVE Window
  // =========================================================================
  describe('Suite 5: Invariants 5 & 6 — Non-Overlapping & Within LIVE Window', () => {
    it('5.1 no two peak windows ever overlap within or across rounds', () => {
      const rand = createPrng(4001);
      // Generate heavy multi-cluster rounds to induce maximum peak allocation
      const segs: RecordedSegment[] = [];
      for (let k = 0; k < 3; k++) {
        const events: ReplayEvent[] = [];
        for (let cluster = 0; cluster < 5; cluster++) {
          const center = 5000 + cluster * 8000;
          for (let i = 0; i < 20; i++) {
            events.push({
              t: center + i * 20,
              type: 'REACTION',
              id: `clust-${k}-${cluster}-${i}`,
              emoji: '🔥',
              lane: 0.5,
              senderId: `p-${i}`,
            });
          }
        }
        segs.push({
          segmentIndex: k,
          headline: `Cluster Round ${k}`,
          writerName: `Writer ${k}`,
          sourceDurationMs: 51000,
          events,
        });
      }

      const payload = buildReplayPayload(segs, Date.now());
      const peaks = payload.speedRanges.filter((r) => r.isPeak);

      for (let i = 0; i < peaks.length - 1; i++) {
        assert.ok(
          peaks[i].endMs <= peaks[i + 1].startMs,
          `Peak overlap detected: [${peaks[i].startMs}, ${peaks[i].endMs}] and [${peaks[i + 1].startMs}, ${peaks[i + 1].endMs}]`,
        );
      }
    });

    it('5.2 all peak windows lie strictly within that round LIVE window [k*47200 + 1200, k*47200 + 46200]', () => {
      const rand = createPrng(4002);
      const segs = [
        generateRandomSegment(0, 50, rand),
        generateRandomSegment(1, 50, rand),
        generateRandomSegment(2, 50, rand),
      ];
      const payload = buildReplayPayload(segs, Date.now());
      const peaks = payload.speedRanges.filter((r) => r.isPeak);

      for (const p of peaks) {
        const k = Math.floor(p.startMs / 47200);
        const liveStart = k * 47200 + 1200;
        const liveEnd = k * 47200 + 46200;
        assert.ok(p.startMs >= liveStart, `Peak start ${p.startMs} before liveStart ${liveStart}`);
        assert.ok(p.endMs <= liveEnd, `Peak end ${p.endMs} after liveEnd ${liveEnd}`);
      }
    });
  });

  // =========================================================================
  // Suite 6: Invariant 7 — Duration Calculation Formula Accuracy
  // =========================================================================
  describe('Suite 6: Invariant 7 — Duration Calculation Formula Accuracy', () => {
    it('6.1 sum((r.endMs - r.startMs) / r.speed) matches totalPlaybackDurationMs within 1.0ms', () => {
      const rand = createPrng(5001);
      for (const N of [1, 2, 3, 4, 5, 8]) {
        const segs: RecordedSegment[] = [];
        for (let k = 0; k < N; k++) {
          segs.push(generateRandomSegment(k, 50 + Math.floor(rand() * 100), rand));
        }
        const payload = buildReplayPayload(segs, Date.now());
        const sum = payload.speedRanges.reduce((acc, r) => acc + (r.endMs - r.startMs) / r.speed, 0);
        const diff = Math.abs(sum - payload.totalPlaybackDurationMs);
        assert.ok(
          diff <= 1.0,
          `N=${N}: formula sum ${sum} vs totalPlaybackDurationMs ${payload.totalPlaybackDurationMs} (diff ${diff})`,
        );
      }
    });
  });

  // =========================================================================
  // Suite 7: Edge Cases & Numerical Robustness
  // =========================================================================
  describe('Suite 7: Edge Cases & Numerical Robustness', () => {
    it('7.1 empty recorded segments list returns valid payload without NaN', () => {
      const payload = buildReplayPayload([], Date.now());
      assert.ok(!Number.isNaN(payload.totalPlaybackDurationMs));
      assert.ok(!Number.isNaN(payload.totalSourceDurationMs));
      assert.ok(payload.speedRanges.length > 0);
      assert.equal(payload.events.length, 0);
    });

    it('7.2 all events concentrated in a single 1ms window', () => {
      const events: ReplayEvent[] = [];
      for (let i = 0; i < 50; i++) {
        events.push({
          t: 20000, // exact same millisecond
          type: 'REACTION',
          id: `burst-same-ms-${i}`,
          emoji: '🔥',
          lane: 0.5,
          senderId: `p-${i}`,
        });
      }
      const seg = {
        segmentIndex: 0,
        headline: 'POINT EVENT BURST',
        writerName: 'Writer 1',
        sourceDurationMs: 51000,
        events,
      };
      const payload = buildReplayPayload([seg], Date.now());
      verifyReplayInvariants(payload, 1, 'Point_Burst_1ms');
      const peaks = payload.speedRanges.filter((r) => r.isPeak);
      assert.ok(peaks.length >= 1);
      // Virtual timestamp of 20000 is 1200 + (20000 - 3000) = 18200ms
      assert.ok(peaks[0].startMs <= 18200 && peaks[0].endMs >= 18200);
    });

    it('7.3 events at exact boundaries (0ms, 1200ms, 3000ms, 48000ms, 51000ms)', () => {
      const events: ReplayEvent[] = [
        { t: 0, type: 'REACTION', id: 'e-0', emoji: '0️⃣', lane: 0.1, senderId: 's1' },
        { t: 1200, type: 'REACTION', id: 'e-1200', emoji: '1️⃣', lane: 0.2, senderId: 's1' },
        { t: 3000, type: 'REACTION', id: 'e-3000', emoji: '3️⃣', lane: 0.3, senderId: 's1' },
        { t: 48000, type: 'REACTION', id: 'e-48000', emoji: '4️⃣', lane: 0.4, senderId: 's1' },
        { t: 51000, type: 'REACTION', id: 'e-51000', emoji: '5️⃣', lane: 0.5, senderId: 's1' },
      ];
      const seg = {
        segmentIndex: 0,
        headline: 'BOUNDARY TEST',
        writerName: 'Writer 1',
        sourceDurationMs: 51000,
        events,
      };
      const payload = buildReplayPayload([seg], Date.now());
      verifyReplayInvariants(payload, 1, 'Exact_Boundary_Timestamps');

      const ev0 = payload.events.find((e) => (e as any).id === 'e-0');
      const ev3k = payload.events.find((e) => (e as any).id === 'e-3000');
      const ev48k = payload.events.find((e) => (e as any).id === 'e-48000');
      const ev51k = payload.events.find((e) => (e as any).id === 'e-51000');

      assert.equal(ev0?.t, 0);
      assert.equal(ev3k?.t, 1200);
      assert.equal(ev48k?.t, 46200);
      assert.equal(ev51k?.t, 47200);
    });

    it('7.4 high-throughput stress benchmark: 10 rounds with 1,500 total events executes in sub-100ms', () => {
      const rand = createPrng(6001);
      const segs: RecordedSegment[] = [];
      for (let k = 0; k < 10; k++) {
        segs.push(generateRandomSegment(k, 150, rand));
      }

      const t0 = performance.now();
      const payload = buildReplayPayload(segs, Date.now());
      const elapsed = performance.now() - t0;

      assert.ok(elapsed < 100, `Replay compilation took ${elapsed.toFixed(1)}ms (expected < 100ms)`);
      verifyReplayInvariants(payload, 10, 'Stress_10_Rounds_1500_Events');
    });
  });
});
