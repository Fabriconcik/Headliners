import type { ReplayEvent, ReplayPayload, ReplaySpeedRange } from '../shared/protocol.js';
import { TIMINGS } from '../shared/constants.js';

export interface RecordedSegment {
  segmentIndex: number;
  headline: string;
  writerName: string;
  // Events with t relative to segment's SPLASH start (0..51_000ms)
  events: ReplayEvent[];
  sourceDurationMs: number;
}

export function scrambleTickerText(original: string): string {
  const chars = Array.from(original);
  const glitchChars = ['@', '#', '?', '!', 'Ы', 'Ж', 'Ъ', '%'];
  for (let i = 0; i < chars.length - 1; i++) {
    if (chars[i] === ' ' || chars[i + 1] === ' ') continue;
    const r = Math.random();
    if (r < 0.38) {
      const tmp = chars[i];
      chars[i] = chars[i + 1];
      chars[i + 1] = tmp;
      i++;
    } else if (r < 0.48) {
      chars[i] = glitchChars[Math.floor(Math.random() * glitchChars.length)];
    }
  }
  return chars.join('');
}

export function buildReplayPayload(
  recordedSegments: RecordedSegment[],
  startedAt: number,
): ReplayPayload {
  const allEvents: ReplayEvent[] = [];
  const liveWindows: Array<{ segIdx: number; startMs: number; endMs: number; isLiveFull: boolean }> = [];

  const rawFullDuration = TIMINGS.SPLASH_MS + TIMINGS.LIVE_MS + TIMINGS.FREEZE_MS; // 51_000ms
  const rawLiveBoundary = TIMINGS.SPLASH_MS + TIMINGS.LIVE_MS; // 48_000ms
  let cursorVirtMs = 0;

  for (let k = 0; k < recordedSegments.length; k++) {
    const seg = recordedSegments[k];
    const isLiveFull = (seg.sourceDurationMs || 0) >= 50_000;
    const segVirtDuration = isLiveFull ? 47_200 : (seg.sourceDurationMs || rawFullDuration);
    const segStartMs = cursorVirtMs;

    // Emit synthetic SEGMENT_START anchor
    allEvents.push({
      t: segStartMs,
      type: 'SEGMENT_START',
      segmentIndex: seg.segmentIndex,
      headline: seg.headline || 'HEADLINE',
      writerName: seg.writerName || 'Writer',
    });

    if (isLiveFull) {
      // Full-length segment timeline compression:
      // SPLASH (0..3000ms) -> 1,200ms (0.4 * t_live)
      // LIVE (3000..48000ms) -> 45,000ms (1200 + t_live - 3000)
      // FREEZE (48000..51000ms) -> 1,000ms (46200 + (t_live - 48000) / 3)
      allEvents.push({ t: segStartMs, type: 'PHASE', phase: 'SPLASH' });
      allEvents.push({ t: segStartMs + 1200, type: 'PHASE', phase: 'LIVE' });
      allEvents.push({ t: segStartMs + 46200, type: 'PHASE', phase: 'FREEZE' });

      const liveStart = segStartMs + 1200;
      const liveEnd = segStartMs + 46200;
      liveWindows.push({ segIdx: k, startMs: liveStart, endMs: liveEnd, isLiveFull: true });

      for (const ev of seg.events) {
        // Exclude PREP events, negative timestamps, and raw live PHASE events (replaced by synthetic anchors)
        if (ev.type === 'PHASE') continue;
        if (ev.t < 0) continue;

        let virtT: number;
        if (ev.t < TIMINGS.SPLASH_MS) {
          virtT = ev.t * 0.4;
        } else if (ev.t < rawLiveBoundary) {
          virtT = 1200 + (ev.t - TIMINGS.SPLASH_MS);
        } else {
          virtT = 46200 + (ev.t - rawLiveBoundary) / 3;
        }

        allEvents.push({
          ...ev,
          t: Math.round(segStartMs + Math.max(0, Math.min(segVirtDuration, virtT))),
        });
      }
    } else {
      // Backward compatibility for pre-trimmed mock test segments:
      // Retain raw timestamps and duration
      const hasLiveEv = seg.events.find((e) => e.type === 'PHASE' && (e as any).phase === 'LIVE');
      const hasFreezeEv = seg.events.find((e) => e.type === 'PHASE' && (e as any).phase === 'FREEZE');

      const liveStart = segStartMs + (hasLiveEv ? hasLiveEv.t : Math.min(1200, Math.round(segVirtDuration * 0.1)));
      const liveEnd = segStartMs + (hasFreezeEv ? hasFreezeEv.t : Math.max(liveStart + 1000, segVirtDuration - 1000));
      liveWindows.push({ segIdx: k, startMs: liveStart, endMs: liveEnd, isLiveFull: false });

      for (const ev of seg.events) {
        if (ev.type === 'PHASE' && (ev as any).phase === 'PREP') continue;
        if (ev.t < 0) continue;

        allEvents.push({
          ...ev,
          t: Math.round(segStartMs + Math.max(0, Math.min(segVirtDuration, ev.t))),
        });
      }
    }

    cursorVirtMs += segVirtDuration;
  }

  allEvents.sort((a, b) => a.t - b.t);
  const totalSourceDurationMs = Math.max(1000, cursorVirtMs);

  // Per-round activity peak detection (3.5s = 3500ms windows at 1.0x)
  const PEAK_DURATION_MS = 3500;
  const primaryPeaks: Array<{ startMs: number; endMs: number; score: number }> = [];
  const secondaryCandidates: Array<{ startMs: number; endMs: number; score: number }> = [];

  for (const lw of liveWindows) {
    const liveLen = lw.endMs - lw.startMs;
    if (liveLen <= 0) continue;

    if (liveLen < PEAK_DURATION_MS) {
      if (lw.isLiveFull) {
        primaryPeaks.push({ startMs: lw.startMs, endMs: lw.endMs, score: 0 });
      }
      continue;
    }

    const roundEvents = allEvents.filter((e) => e.t >= lw.startMs && e.t <= lw.endMs);
    const stepMs = 250;
    const maxStart = lw.endMs - PEAK_DURATION_MS;
    const candidates: Array<{ startMs: number; endMs: number; score: number }> = [];

    for (let t_s = lw.startMs; t_s <= maxStart; t_s += stepMs) {
      const t_e = t_s + PEAK_DURATION_MS;
      let score = 0;
      for (const ev of roundEvents) {
        if (ev.t >= t_s && ev.t <= t_e) {
          if (ev.type === 'SABOTAGE_VISUAL' || ev.type === 'SABOTAGE_FX') score += 5.0;
          else if (ev.type === 'BREAKING_NEWS') score += 4.5;
          else if (ev.type === 'TICKER_HACK') score += 4.0;
          else if (ev.type === 'SHIELD' || ev.type === 'WIPERS') score += 3.0;
          else if (ev.type === 'TICKER_CLEAN') score += 2.5;
          else if (ev.type === 'REACTION') score += 1.5;
          else if (ev.type === 'STAMP_ADD' || ev.type === 'UNDO_ITEM') score += 0.5;
        }
      }
      candidates.push({ startMs: t_s, endMs: t_e, score });
    }

    candidates.sort((a, b) => b.score - a.score || a.startMs - b.startMs);

    if (candidates.length > 0 && candidates[0].score > 0) {
      const p1 = candidates[0];
      primaryPeaks.push(p1);

      // Look for eligible non-overlapping secondary peak candidate (heat >= 3.0)
      const p2 = candidates.find(
        (c) => Math.abs(c.startMs - p1.startMs) >= PEAK_DURATION_MS && c.score >= 3.0,
      );
      if (p2) {
        secondaryCandidates.push(p2);
      }
    } else if (lw.isLiveFull) {
      // Full-length segment with zero activity: allocate 1 default midpoint peak window (3.5s)
      const defaultMid = lw.startMs + Math.round((liveLen - PEAK_DURATION_MS) / 2);
      primaryPeaks.push({ startMs: defaultMid, endMs: defaultMid + PEAK_DURATION_MS, score: 0 });
    }
  }

  // Peak budget enforcement:
  // For N <= 3: max 4 total peaks across match (guarantees at least 1 per round, max 2 in any round)
  // For N >= 4: max N total peaks (1 per round) to preserve total playback duration bounds
  const chosenPeaks: Array<{ startMs: number; endMs: number }> = [...primaryPeaks];
  const maxTotalPeaks = recordedSegments.length <= 3 ? 4 : recordedSegments.length;
  const remainingBudget = maxTotalPeaks - chosenPeaks.length;

  if (remainingBudget > 0 && secondaryCandidates.length > 0) {
    secondaryCandidates.sort((a, b) => b.score - a.score || a.startMs - b.startMs);
    const toAdd = secondaryCandidates.slice(0, remainingBudget);
    for (const p of toAdd) {
      chosenPeaks.push({ startMs: p.startMs, endMs: p.endMs });
    }
  }

  chosenPeaks.sort((a, b) => a.startMs - b.startMs);

  // Dynamic base speed formula:
  // T_playback = T_peak + D_fast / S_base
  // Nominal target: 48,000ms
  const peakSourceMs = chosenPeaks.reduce((sum, p) => sum + (p.endMs - p.startMs), 0);
  const nonPeakSourceMs = Math.max(0, totalSourceDurationMs - peakSourceMs);

  const targetTotalPlaybackMs = 48_000;
  const targetNonPeakPlaybackMs = Math.max(1000, targetTotalPlaybackMs - peakSourceMs);
  const rawBaseSpeed = nonPeakSourceMs > 0 ? nonPeakSourceMs / targetNonPeakPlaybackMs : 2.8;

  // The documented contract is a base speed inside 2.5x–3.5x for every match size.
  // For N >= 4 (only reachable in test mode, since a real room caps writers at 3)
  // hitting the 48s target would require 5x–33x playback, which is unwatchable.
  // Prefer the speed band and let the total duration grow adaptively instead.
  const baseSpeed = Number(Math.min(3.5, Math.max(2.5, rawBaseSpeed)).toFixed(2));

  // Speed ranges contiguous partition coverage
  const speedRanges: ReplaySpeedRange[] = [];
  let pos = 0;
  for (const peak of chosenPeaks) {
    if (peak.startMs > pos) {
      speedRanges.push({
        startMs: pos,
        endMs: peak.startMs,
        speed: baseSpeed,
        isPeak: false,
      });
    }
    speedRanges.push({
      startMs: peak.startMs,
      endMs: peak.endMs,
      speed: 1.0,
      isPeak: true,
    });
    pos = peak.endMs;
  }
  if (pos < totalSourceDurationMs) {
    speedRanges.push({
      startMs: pos,
      endMs: totalSourceDurationMs,
      speed: baseSpeed,
      isPeak: false,
    });
  }

  const totalPlaybackDurationMs = Math.round(
    speedRanges.reduce((acc, r) => acc + (r.endMs - r.startMs) / r.speed, 0),
  );

  return {
    startedAt,
    totalSourceDurationMs,
    totalPlaybackDurationMs,
    speedRanges,
    events: allEvents,
  };
}
