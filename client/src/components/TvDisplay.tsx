import { useEffect, useRef } from 'react';
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
  phaseBadge?: string;
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
  phaseBadge,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const now = Date.now() + clockOffsetMs;
  const isFlipped = effects.flippedUntil > now;
  const isGlitching = effects.glitchUntil > now;

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
      });

      // Keep rendering while dynamic animations are active
      if (isGlitching || wipersProgress !== null) {
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
          isTargeting ? 'crosshair-cursor' : ''
        }`}
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
        />

        {/* Floating Emojis */}
        <FloatingReactions reactions={reactions} />

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
            <TickerBar messages={tickerMessages} />
          </div>
        )}
      </div>
    </div>
  );
}
