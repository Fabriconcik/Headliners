import { useState, useEffect, useRef } from 'react';
import type { CanvasDrawItem, SabotageVisualItem, ActiveEffectsState, TickerMessage } from '@shared/protocol';
import { renderTvCanvas } from '../engine/canvasRender';
import { TIMINGS } from '@shared/constants';
import { FloatingReactions } from './FloatingReactions';
import { TickerBar } from './TickerBar';
import type { FloatingReaction } from '../net/useGameSocket';

interface Props {
  drawItems: CanvasDrawItem[];
  sabotageItems: SabotageVisualItem[];
  effects: ActiveEffectsState;
  clockOffsetMs: number;
  reactions?: FloatingReaction[];
  headline?: string;
  tickerMessages?: TickerMessage[];
  showOverlays?: boolean;
  isTargeting?: boolean;
  onTargetClick?: (normX: number, normY: number) => void;
  onPointerDown?: (e: React.PointerEvent<HTMLCanvasElement>, normX: number, normY: number) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLCanvasElement>, normX: number, normY: number) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLCanvasElement>, normX: number, normY: number) => void;
  onPointerCancel?: (e: React.PointerEvent<HTMLCanvasElement>, normX: number, normY: number) => void;
  onWheel?: (e: React.WheelEvent<HTMLCanvasElement>) => void;
  phaseBadge?: string;
  zoom?: number;
  pan?: { x: number; y: number };
}

export function TvDisplay({
  drawItems,
  sabotageItems,
  effects,
  clockOffsetMs,
  reactions = [],
  headline,
  tickerMessages = [],
  showOverlays = true,
  isTargeting = false,
  onTargetClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onWheel,
  phaseBadge,
  zoom = 1,
  pan = { x: 0, y: 0 },
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [renderTick, setRenderTick] = useState(0);
  const now = Date.now() + clockOffsetMs;
  const isFlipped = effects.flippedUntil > now;
  const isGlitching = effects.glitchUntil > now;

  useEffect(() => {
    const untils = [
      effects.breakingNewsUntil ?? 0,
      effects.shieldUntil ?? 0,
      effects.glitchUntil ?? 0,
      effects.flippedUntil ?? 0,
      effects.wipersAnimUntil ?? 0,
      effects.staticNoiseUntil ?? 0,
      effects.shakeUntil ?? 0,
    ].filter((u) => u > now);
    if (untils.length === 0) return;
    const nextTimeout = Math.min(...untils) - now;
    if (nextTimeout <= 0) return;
    const timer = setTimeout(() => {
      setRenderTick((t) => t + 1);
    }, nextTimeout + 40);
    return () => clearTimeout(timer);
  }, [effects, now, renderTick]);

  const getNormCoords = (clientX: number, clientY: number) => {
    if (!canvasRef.current) return { x: 0.5, y: 0.5 };
    const rect = canvasRef.current.getBoundingClientRect();
    const rawX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const rawY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    // When the frame is flipped 180deg via CSS transform, the canvas top-left
    // is rotated to the screen bottom-right. Invert coords so user touches map
    // directly to the visual position under their finger.
    const x = isFlipped ? 1 - rawX : rawX;
    const y = isFlipped ? 1 - rawY : rawY;
    return { x, y };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isSubscribed = true;

    const render = () => {
      if (!isSubscribed) return;
      const now = Date.now() + clockOffsetMs;
      const isGlitching = effects.glitchUntil > now;
      const isShielded = (effects.shieldUntil ?? 0) > now;
      let wipersProgress: number | null = null;
      if (effects.wipersAnimUntil > now) {
        const remaining = effects.wipersAnimUntil - now;
        const elapsed = TIMINGS.WIPERS_ANIM_MS - remaining;
        wipersProgress = Math.max(0, Math.min(1, elapsed / TIMINGS.WIPERS_ANIM_MS));
      }

      renderTvCanvas(ctx, canvas.width, canvas.height, {
        drawItems,
        sabotageItems,
        isGlitching,
        wipersProgress,
        isShielded,
      });

      // Keep rendering while dynamic animations are active
      if (isGlitching || wipersProgress !== null || isShielded) {
        animFrameRef.current = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      isSubscribed = false;
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [drawItems, sabotageItems, effects, clockOffsetMs]);

  return (
    <div className="aspect-16-9-wrap">
      <div
        className={`tv-frame ${isFlipped ? 'flipped' : ''} ${isGlitching ? 'glitch-shake' : ''} ${
          (effects.shakeUntil ?? 0) > now ? 'camera-shake' : ''
        } ${isTargeting ? 'crosshair-cursor' : ''}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
        onClick={(e) => {
          if (isTargeting && onTargetClick) {
            const { x, y } = getNormCoords(e.clientX, e.clientY);
            onTargetClick(x, y);
          }
        }}
      >
        {/* Top headline overlay (for viewer/saboteur/writer TV view) */}
        {showOverlays && headline && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              background: 'linear-gradient(180deg, rgba(9, 13, 22, 0.95) 0%, rgba(9, 13, 22, 0.75) 75%, transparent 100%)',
              padding: '6px 12px 14px',
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div
              style={{
                fontSize: 'clamp(12px, 2.5cqh, 18px)',
                fontWeight: 900,
                color: '#ffffff',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                textShadow: '0 2px 4px rgba(0, 0, 0, 0.8)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {headline}
            </div>

            {phaseBadge && (
              <div className="badge badge-red" style={{ flexShrink: 0 }}>
                <span className="live-dot" />
                {phaseBadge}
              </div>
            )}
          </div>
        )}

        {/* Center Canvas */}
        <canvas
          ref={canvasRef}
          width={1280}
          height={720}
          style={{
            width: '100%',
            height: '100%',
            touchAction: 'none',
            display: 'block',
            transform:
              zoom > 1 || pan.x !== 0 || pan.y !== 0
                ? `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
                : undefined,
            transformOrigin: 'center center',
          }}
          onPointerDown={(e) => {
            const { x, y } = getNormCoords(e.clientX, e.clientY);
            if (isTargeting && onTargetClick) {
              onTargetClick(x, y);
              return;
            }
            onPointerDown?.(e, x, y);
          }}
          onPointerMove={(e) => {
            const { x, y } = getNormCoords(e.clientX, e.clientY);
            onPointerMove?.(e, x, y);
          }}
          onPointerUp={(e) => {
            const { x, y } = getNormCoords(e.clientX, e.clientY);
            onPointerUp?.(e, x, y);
          }}
          onPointerCancel={(e) => {
            const { x, y } = getNormCoords(e.clientX, e.clientY);
            onPointerCancel?.(e, x, y);
          }}
          onWheel={onWheel}
        />

        {/* Floating Emojis */}
        <FloatingReactions reactions={reactions} />

        {/* Static TV Snow Noise Overlay */}
        {(effects.staticNoiseUntil ?? 0) > now && <div className="static-noise-overlay" />}

        {/* Breaking News Flash Overlay */}
        {(effects.breakingNewsUntil ?? 0) > now && (
          <div
            className="breaking-news-overlay"
            style={{
              position: 'absolute',
              top: '25%',
              left: 0,
              right: 0,
              zIndex: 35,
              background: 'linear-gradient(90deg, rgba(239, 68, 68, 0.95), rgba(245, 158, 11, 0.95), rgba(239, 68, 68, 0.95))',
              color: '#ffffff',
              padding: '10px 16px',
              textAlign: 'center',
              boxShadow: '0 0 30px rgba(239, 68, 68, 0.8), 0 4px 16px rgba(0,0,0,0.6)',
              borderTop: '2px solid #ffffff',
              borderBottom: '2px solid #ffffff',
              pointerEvents: 'none',
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 900, letterSpacing: '2px', color: '#fef08a' }}>
              ⚡ ЭКСТРЕННАЯ МОЛНИЯ В ЭФИРЕ ⚡
            </div>
            <div
              style={{
                fontSize: 'clamp(14px, 3.2cqh, 22px)',
                fontWeight: 900,
                textTransform: 'uppercase',
                textShadow: '0 2px 4px #000',
              }}
            >
              {effects.breakingNewsAuthor
                ? `СПЕЦКОР ${effects.breakingNewsAuthor} ПЕРЕДАЕТ СРОЧНО!`
                : 'СРОЧНОЕ ВКЛЮЧЕНИЕ ИЗ ЦЕНТРА СОБЫТИЙ!'}
            </div>
          </div>
        )}

        {/* Shield active badge overlay */}
        {(effects.shieldUntil ?? 0) > now && (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 30,
              background: 'rgba(6, 182, 212, 0.92)',
              color: '#090d16',
              padding: '3px 12px',
              borderRadius: '999px',
              fontSize: '11px',
              fontWeight: 900,
              letterSpacing: '1px',
              boxShadow: '0 0 16px rgba(6, 182, 212, 0.85)',
              pointerEvents: 'none',
            }}
          >
            🛡️ ЗАЩИТНЫЙ ЭКРАН АКТИВЕН
          </div>
        )}

        {/* Bottom Ticker overlay (for TV view) */}
        {showOverlays && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 20,
            }}
          >
            <TickerBar messages={tickerMessages ?? []} headline={headline} />
          </div>
        )}
      </div>
    </div>
  );
}
