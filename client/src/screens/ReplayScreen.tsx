import { useState, useEffect, useRef } from 'react';
import { FastForward, Flame, SkipForward, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import type {
  RoomStateSnapshot,
  C2SMessage,
  CanvasDrawItem,
  SabotageVisualItem,
  TickerMessage,
  ActiveEffectsState,
  ReplaySpeedRange,
} from '@shared/protocol';
import { TIMINGS } from '@shared/constants';
import { sfx } from '../audio/sfx';
import { TvDisplay } from '../components/TvDisplay';
import type { FloatingReaction } from '../net/useGameSocket';

interface Props {
  snapshot: RoomStateSnapshot;
  playerId: string | null;
  clockOffsetMs: number;
  send: (msg: C2SMessage) => void;
}

export function ReplayScreen({ snapshot, playerId, clockOffsetMs, send }: Props) {
  const isHost = playerId === snapshot.hostId;
  const replay = snapshot.replay;

  const [tPlayback, setTPlayback] = useState(0);
  const [muted, setMuted] = useState(sfx.muted);
  const [cleanReplay, setCleanReplay] = useState<boolean>(
    Boolean(snapshot.cleanReplay ?? replay?.cleanReplay),
  );
  const playedEventIndicesRef = useRef<Set<number>>(new Set());

  // Animation frame loop for smooth 60fps replay playback
  useEffect(() => {
    if (!replay) return;
    let animId: number;

    const tick = () => {
      const now = Date.now() + clockOffsetMs;
      const elapsed = Math.max(0, now - replay.startedAt);
      setTPlayback(elapsed);
      // Stop the 60fps loop once the replay is finished to prevent battery drain
      if (elapsed < replay.totalPlaybackDurationMs + 100) {
        animId = requestAnimationFrame(tick);
      }
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [replay, clockOffsetMs]);

  if (!replay) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100dvh',
          background: 'var(--bg)',
        }}
      >
        Монтаж и склейка итогового выпуска...
      </div>
    );
  }

  // 1. Calculate virtual time in source timeline from playback elapsed time
  let virtT = 0;
  let accumulatedPlayback = 0;
  let currentSpeedRange: ReplaySpeedRange | null = null;

  for (const range of replay.speedRanges) {
    const rangePlaybackMs = (range.endMs - range.startMs) / range.speed;
    if (tPlayback < accumulatedPlayback + rangePlaybackMs) {
      const frac = Math.max(0, (tPlayback - accumulatedPlayback) / rangePlaybackMs);
      virtT = range.startMs + frac * (range.endMs - range.startMs);
      currentSpeedRange = range;
      break;
    }
    accumulatedPlayback += rangePlaybackMs;
    virtT = range.endMs;
    currentSpeedRange = range;
  }

  const isFinished = tPlayback >= replay.totalPlaybackDurationMs;
  if (isFinished) {
    virtT = replay.totalSourceDurationMs;
  }

  // 2. Reconstruct visual state up to virtT
  let headline = 'ИТОГОВЫЙ ВЫПУСК';
  let segmentIndex = 0;
  const drawItemsMap = new Map<string, CanvasDrawItem>();
  let sabotageItems: SabotageVisualItem[] = [];
  const tickerMap = new Map<string, TickerMessage>();
  const activeReactions: FloatingReaction[] = [];

  let effects: ActiveEffectsState = {
    flippedUntil: 0,
    glitchUntil: 0,
    forcedBrushUntil: 0,
    wipersAnimUntil: 0,
  };

  for (let i = 0; i < replay.events.length; i++) {
    const ev = replay.events[i];
    if (ev.t > virtT) break;

    // Trigger subtle sfx on event boundary
    if (!playedEventIndicesRef.current.has(i)) {
      playedEventIndicesRef.current.add(i);
      if (ev.type === 'PHASE' && ev.phase === 'SPLASH') sfx.playNewsJingle();
      if (ev.type === 'PHASE' && ev.phase === 'FREEZE') sfx.playShutter();
      if (!cleanReplay && ev.type === 'WIPERS') sfx.playWipers();
      if (!cleanReplay && ev.type === 'SABOTAGE_VISUAL') sfx.playSplat();
      if (!cleanReplay && ev.type === 'SABOTAGE_FX') sfx.playGlitch();
      if (ev.type === 'REACTION') sfx.playPop();
    }

    if (ev.type === 'SEGMENT_START') {
      headline = ev.headline;
      segmentIndex = ev.segmentIndex;
      // Reset canvas and ticker between segments
      drawItemsMap.clear();
      sabotageItems = [];
      tickerMap.clear();
    } else if (ev.type === 'STROKE_ADD') {
      drawItemsMap.set(ev.item.id, { ...ev.item, points: [...ev.item.points] });
    } else if (ev.type === 'STROKE_UPDATE') {
      const existing = drawItemsMap.get(ev.id);
      if (existing && existing.kind === 'stroke') {
        existing.points = [...existing.points, ...ev.points];
      }
    } else if (ev.type === 'STAMP_ADD') {
      drawItemsMap.set(ev.item.id, ev.item);
    } else if (ev.type === 'UNDO_ITEM') {
      drawItemsMap.delete(ev.itemId);
    } else if (ev.type === 'WIPERS') {
      sabotageItems = [];
      if (!cleanReplay && virtT - ev.t <= TIMINGS.WIPERS_ANIM_MS) {
        effects.wipersAnimUntil = Date.now() + (TIMINGS.WIPERS_ANIM_MS - (virtT - ev.t));
      }
    } else if (ev.type === 'SABOTAGE_VISUAL') {
      if (!cleanReplay) {
        sabotageItems.push(ev.item);
      }
    } else if (ev.type === 'SABOTAGE_FX') {
      if (!cleanReplay) {
        if (ev.fx === 'flip' && virtT - ev.t <= TIMINGS.FLIP_DURATION_MS) {
          effects.flippedUntil = Date.now() + (TIMINGS.FLIP_DURATION_MS - (virtT - ev.t));
        }
        if (ev.fx === 'glitch' && virtT - ev.t <= TIMINGS.GLITCH_DURATION_MS) {
          effects.glitchUntil = Date.now() + (TIMINGS.GLITCH_DURATION_MS - (virtT - ev.t));
        }
      }
    } else if (ev.type === 'TICKER_ADD') {
      tickerMap.set(ev.id, {
        id: ev.id,
        authorName: ev.authorName,
        text: ev.text,
        createdAt: ev.t,
      });
    } else if (ev.type === 'TICKER_HACK') {
      if (!cleanReplay) {
        const existing = tickerMap.get(ev.id);
        if (existing) {
          existing.hackedText = ev.hackedText;
        }
      }
    } else if (ev.type === 'REACTION') {
      if (virtT - ev.t <= 2000) {
        activeReactions.push({
          id: ev.id,
          emoji: ev.emoji,
          lane: ev.lane,
          createdAt: ev.t,
        });
      }
    }
  }

  const drawItems = Array.from(drawItemsMap.values());
  const tickerMessages = Array.from(tickerMap.values());

  const currentSec = Math.floor(Math.min(tPlayback, replay.totalPlaybackDurationMs) / 1000);
  const totalSec = Math.floor(replay.totalPlaybackDurationMs / 1000);
  const progressPct = Math.min(100, (tPlayback / replay.totalPlaybackDurationMs) * 100);

  const isPeak = currentSpeedRange?.isPeak ?? false;
  const speed = currentSpeedRange?.speed ?? 2.8;

  const toggleMute = () => {
    sfx.muted = !sfx.muted;
    setMuted(sfx.muted);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100dvh',
        background: 'radial-gradient(circle at top, #172033 0%, #090d16 90%)',
        overflow: 'hidden',
      }}
    >
      {/* Top Replay Status Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          zIndex: 40,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="badge badge-red" style={{ fontSize: '11px' }}>
            ИТОГОВЫЙ ПОВТОР
          </div>
          <span style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 600 }}>
            Сюжет #{segmentIndex + 1}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Dynamic Speed Badge */}
          <div
            className={`badge ${isPeak ? 'badge-amber' : 'badge-cyan'}`}
            style={{
              fontSize: '12px',
              padding: '4px 10px',
              boxShadow: isPeak ? '0 0 12px rgba(245, 158, 11, 0.6)' : 'none',
              animation: isPeak ? 'pulse-live 0.8s infinite' : 'none',
            }}
          >
            {isPeak ? <Flame size={14} color="#f59e0b" /> : <FastForward size={14} />}
            <span>{isPeak ? '🔥 1.0x ЭПИЧНЫЙ МОМЕНТ' : `⚡ ${speed.toFixed(1)}x ПОВТОР`}</span>
          </div>

          {/* Sound Mute Toggle */}
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={toggleMute}
            title={muted ? 'Включить звук' : 'Выключить звук'}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
      </div>

      {/* Main TV Player Area */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '8px',
          position: 'relative',
        }}
      >
        <TvDisplay
          drawItems={drawItems}
          sabotageItems={sabotageItems}
          effects={effects}
          clockOffsetMs={0}
          reactions={activeReactions}
          headline={headline}
          tickerMessages={tickerMessages}
          showOverlays={true}
        />
      </div>

      {/* Bottom Scrubber & Host Controls */}
      <div
        style={{
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          padding: '10px 16px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          zIndex: 40,
        }}
      >
        {/* Progress bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#f8fafc', width: '40px' }}>
            {String(Math.floor(currentSec / 60)).padStart(2, '0')}:
            {String(currentSec % 60).padStart(2, '0')}
          </span>

          <div
            style={{
              flex: 1,
              height: '6px',
              background: 'var(--surface-2)',
              borderRadius: '999px',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progressPct}%`,
                background: isPeak ? '#f59e0b' : '#06b6d4',
                borderRadius: '999px',
                transition: 'width 0.1s linear',
              }}
            />
          </div>

          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', width: '40px' }}>
            {String(Math.floor(totalSec / 60)).padStart(2, '0')}:
            {String(totalSec % 60).padStart(2, '0')}
          </span>
        </div>

        {/* Buttons / Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className={`btn btn-sm ${cleanReplay ? 'btn-accent' : 'btn-secondary'}`}
              onClick={() => setCleanReplay((prev) => !prev)}
              title="Переключить чистый показ без саботажа зрителей"
              style={{ fontSize: '11px', padding: '4px 8px' }}
            >
              {cleanReplay ? '✨ Чистый повтор' : '🎭 Полный эфир'}
            </button>

            {isFinished ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '16px' }}>🎉</span>
                <span style={{ fontWeight: 800, fontSize: '13px', color: '#10b981' }}>
                  Выпуск завершен!
                </span>
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                Смотрим синхронно...
              </div>
            )}
          </div>

          {isHost ? (
            <div style={{ display: 'flex', gap: '8px' }}>
              {!isFinished && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => send({ type: 'SKIP_REPLAY' })}
                >
                  <SkipForward size={14} /> Пропустить
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => send({ type: 'RETURN_TO_LOBBY' })}
              >
                <RotateCcw size={14} /> В лобби (сыграть ещё)
              </button>
            </div>
          ) : (
            isFinished && (
              <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                Ожидаем возврата в лобби от шеф-редактора...
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
