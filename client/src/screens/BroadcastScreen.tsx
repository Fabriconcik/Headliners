import { useState, useEffect, useRef } from 'react';
import {
  Radio,
  Clock,
  Send,
  Sparkles,
  Undo2,
  Crosshair,
  Check,
  Dices,
  SmilePlus,
  Edit2,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
} from 'lucide-react';
import type {
  RoomStateSnapshot,
  C2SMessage,
  PointNorm,
} from '@shared/protocol';
import {
  FALLBACK_HEADLINES,
  QUICK_REACTIONS,
  ABILITIES,
  SABOTEUR_CLASSES,
  ARTIST_COLORS,
  BRUSH_WIDTHS,
  FORCED_BRUSH,
  type BrushSizeKey,
  type AbilityId,
} from '@shared/constants';
import { STAMPS, type StampDefinition } from '@shared/stamps';
import { extractSingleEmoji } from '@shared/emoji';
import { sfx } from '../audio/sfx';
import { TvDisplay } from '../components/TvDisplay';
import { TickerBar } from '../components/TickerBar';
import type { FloatingReaction } from '../net/useGameSocket';

interface Props {
  snapshot: RoomStateSnapshot;
  playerId: string | null;
  clockOffsetMs: number;
  reactions: FloatingReaction[];
  send: (msg: C2SMessage) => void;
  optimisticStrokeStart: (
    id: string,
    authorId: string,
    color: string,
    widthNorm: number,
    point: PointNorm,
  ) => void;
  optimisticStrokePoints: (id: string, points: PointNorm[]) => void;
}

export function BroadcastScreen({
  snapshot,
  playerId,
  clockOffsetMs,
  reactions,
  send,
  optimisticStrokeStart,
  optimisticStrokePoints,
}: Props) {
  const me = snapshot.players.find((p) => p.id === playerId);
  const segment = snapshot.segment;

  // Sound mute state
  const [muted, setMuted] = useState(sfx.muted);
  const toggleMute = () => {
    sfx.muted = !sfx.muted;
    setMuted(sfx.muted);
  };

  // Camera flash animation on FREEZE
  const [flashActive, setFlashActive] = useState(false);

  // Smooth wall-clock ticker for cooldowns and countdowns
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const now = nowTick + clockOffsetMs;
  const isFlipped = (snapshot.effects?.flippedUntil ?? 0) > now;

  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Phase countdown timer
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (!segment) return;
    const left = Math.max(0, Math.ceil((segment.phaseEndsAt - now) / 1000));
    setTimeLeft(left);
  }, [segment?.phaseEndsAt, segment?.phase, now]);

  // Saboteur QoL: chime when an ability becomes newly affordable
  const prevEnergyRef = useRef<number>(me?.energy ?? 0);
  useEffect(() => {
    if (me?.role !== 'saboteur' || !me.saboteurClass) return;
    const prev = prevEnergyRef.current;
    const current = me.energy;
    prevEnergyRef.current = current;
    if (current > prev) {
      const cls = SABOTEUR_CLASSES[me.saboteurClass];
      const abilities = [...cls.abilities, cls.specialAbility].map((id) => ABILITIES[id]);
      const newlyAffordable = abilities.some((ab) => prev < ab.cost && current >= ab.cost);
      if (newlyAffordable) {
        sfx.playAffordable();
      }
    }
  }, [me?.energy, me?.role, me?.saboteurClass]);

  // Lead writer headline submission state
  const [headlineInput, setHeadlineInput] = useState('');

  // Writer ticker message state
  const [tickerInput, setTickerInput] = useState('');

  // Reset inputs when segment changes or on entering PREP
  const prevSegmentIdxRef = useRef<number | null>(null);
  useEffect(() => {
    if (!segment) return;
    if (prevSegmentIdxRef.current !== segment.index) {
      prevSegmentIdxRef.current = segment.index;
      setHeadlineInput('');
      setTickerInput('');
      currentStrokeIdRef.current = null;
      activePointerIdRef.current = null;
      setTargetingAbility(null);
    }
  }, [segment?.index]);

  // Clean up drawing / targeting and trigger flash when phase changes
  useEffect(() => {
    if (!segment) return;
    if (segment.phase === 'FREEZE') {
      setFlashActive(true);
      const timer = setTimeout(() => setFlashActive(false), 350);
      return () => clearTimeout(timer);
    }
    if (segment.phase !== 'LIVE') {
      currentStrokeIdRef.current = null;
      activePointerIdRef.current = null;
      setTargetingAbility(null);
    }
  }, [segment?.phase]);

  // Artist drawing tool state
  const [brushMode, setBrushMode] = useState<'stroke' | 'stamp'>('stroke');
  const [selectedColor, setSelectedColor] = useState<string>(ARTIST_COLORS[0]);
  const [selectedBrushSize, setSelectedBrushSize] = useState<BrushSizeKey>('medium');
  const [selectedStamp, setSelectedStamp] = useState<StampDefinition>(STAMPS[0]);
  const [stampsDrawerOpen, setStampsDrawerOpen] = useState(false);

  // Active stroke tracking refs & multi-touch cancellation
  const activePointerIdRef = useRef<number | null>(null);
  const currentStrokeIdRef = useRef<string | null>(null);
  const strokeBufferRef = useRef<PointNorm[]>([]);
  const lastSendPointsTimeRef = useRef<number>(0);

  // Artist Zoom & Pan state
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanMode, setIsPanMode] = useState<boolean>(false);

  const activePointersRef = useRef<Map<number, { clientX: number; clientY: number }>>(new Map());
  const pinchDistStartRef = useRef<number>(0);
  const pinchZoomStartRef = useRef<number>(1);
  const pinchPanStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pinchMidStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isPinchingRef = useRef<boolean>(false);
  const singlePanStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);

  // Saboteur state
  const [customEmoji, setCustomEmoji] = useState<string>(() => {
    return localStorage.getItem('news_custom_emoji') || '';
  });
  const [customEmojiEditing, setCustomEmojiEditing] = useState(false);
  const [customEmojiInput, setCustomEmojiInput] = useState('');
  const [customEmojiError, setCustomEmojiError] = useState(false);
  const [targetingAbility, setTargetingAbility] = useState<AbilityId | null>(null);
  const lastReactionTapRef = useRef<number>(0);

  const triggerHaptic = (ms: number = 10) => {
    try {
      navigator.vibrate?.(ms);
    } catch {}
  };

  const isForcedBrush = snapshot.effects.forcedBrushUntil > now;
  const forcedBrushRemaining = isForcedBrush
    ? Math.max(0, Math.ceil((snapshot.effects.forcedBrushUntil - now) / 1000))
    : 0;

  const effectiveColor = isForcedBrush ? FORCED_BRUSH.color : selectedColor;
  const effectiveWidthNorm = isForcedBrush
    ? FORCED_BRUSH.widthNorm
    : BRUSH_WIDTHS[selectedBrushSize];

  // Cooldowns
  const wipersRemaining = me?.wipersCooldownUntil
    ? Math.max(0, Math.ceil((me.wipersCooldownUntil - now) / 1000))
    : 0;

  const shieldRemaining = me?.shieldCooldownUntil
    ? Math.max(0, Math.ceil((me.shieldCooldownUntil - now) / 1000))
    : 0;

  const breakingNewsRemaining = me?.breakingNewsCooldownUntil
    ? Math.max(0, Math.ceil((me.breakingNewsCooldownUntil - now) / 1000))
    : 0;

  // --- Handlers ---
  const handleRandomHeadline = () => {
    const random =
      FALLBACK_HEADLINES[Math.floor(Math.random() * FALLBACK_HEADLINES.length)];
    setHeadlineInput(random);
  };

  const handleSubmitHeadline = (e?: React.FormEvent) => {
    e?.preventDefault();
    const finalHeadline = headlineInput.trim();
    send({ type: 'SUBMIT_HEADLINE', headline: finalHeadline });
  };

  const handleAddTicker = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!tickerInput.trim()) return;
    send({ type: 'ADD_TICKER', text: tickerInput.trim() });
    setTickerInput('');
  };

  const handleSendReaction = (emoji: string) => {
    const nowTime = Date.now();
    if (nowTime - lastReactionTapRef.current < 250) return;
    lastReactionTapRef.current = nowTime;
    send({ type: 'SEND_REACTION', emoji });
  };

  const handleSaveCustomEmoji = (e: React.FormEvent) => {
    e.preventDefault();
    const valid = extractSingleEmoji(customEmojiInput);
    if (valid) {
      setCustomEmoji(valid);
      localStorage.setItem('news_custom_emoji', valid);
      setCustomEmojiEditing(false);
      setCustomEmojiInput('');
      setCustomEmojiError(false);
    } else {
      setCustomEmojiError(true);
    }
  };

  const handleAbilityClick = (abilityId: AbilityId) => {
    const config = ABILITIES[abilityId];
    if (!config || (me?.energy ?? 0) < config.cost || segment?.phase !== 'LIVE') return;

    if (config.positional) {
      // Toggle targeting mode on TV screen
      if (targetingAbility === abilityId) {
        setTargetingAbility(null);
      } else {
        setTargetingAbility(abilityId);
      }
    } else {
      send({ type: 'USE_ABILITY', abilityId });
    }
  };

  const handleTargetClick = (normX: number, normY: number) => {
    if (targetingAbility) {
      triggerHaptic(15);
      send({ type: 'USE_ABILITY', abilityId: targetingAbility, x: normX, y: normY });
      setTargetingAbility(null);
    }
  };

  // Artist Pointer Events
  const handlePointerDown = (
    e: React.PointerEvent<HTMLCanvasElement>,
    normX: number,
    normY: number,
  ) => {
    if (segment?.phase !== 'LIVE' || me?.role !== 'artist') return;

    activePointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

    // Multi-touch pinch detection
    if (activePointersRef.current.size >= 2) {
      if (currentStrokeIdRef.current) {
        const id = currentStrokeIdRef.current;
        currentStrokeIdRef.current = null;
        if (strokeBufferRef.current.length > 0) {
          const pointsToSend = [...strokeBufferRef.current];
          strokeBufferRef.current = [];
          optimisticStrokePoints(id, pointsToSend);
          send({ type: 'STROKE_POINTS', id, points: pointsToSend });
        }
        send({ type: 'STROKE_END', id });
      }
      activePointerIdRef.current = null;
      isPinchingRef.current = true;
      singlePanStartRef.current = null;

      const pts = Array.from(activePointersRef.current.values());
      pinchDistStartRef.current = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      pinchZoomStartRef.current = zoom;
      pinchPanStartRef.current = { ...pan };
      pinchMidStartRef.current = {
        x: (pts[0].clientX + pts[1].clientX) / 2,
        y: (pts[0].clientY + pts[1].clientY) / 2,
      };
      return;
    }

    // Pan mode single finger drag
    if (isPanMode) {
      singlePanStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}
      return;
    }

    // Normal single finger drawing
    if (activePointerIdRef.current !== null) return;
    activePointerIdRef.current = e.pointerId;

    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignored
    }

    if (brushMode === 'stamp' && !isForcedBrush) {
      triggerHaptic(10);
      const stampId = selectedStamp.id;
      const id = Math.random().toString(36).slice(2) + Date.now();
      send({
        type: 'PLACE_STAMP',
        id,
        stampId,
        color: effectiveColor,
        x: normX,
        y: normY,
      });
      activePointerIdRef.current = null;
      return;
    }

    // Stroke mode
    triggerHaptic(10);
    const id = Math.random().toString(36).slice(2) + Date.now();
    currentStrokeIdRef.current = id;
    strokeBufferRef.current = [{ x: normX, y: normY }];
    lastSendPointsTimeRef.current = Date.now();

    optimisticStrokeStart(id, me.id, effectiveColor, effectiveWidthNorm, {
      x: normX,
      y: normY,
    });
    send({
      type: 'STROKE_START',
      id,
      color: effectiveColor,
      widthNorm: effectiveWidthNorm,
      point: { x: normX, y: normY },
    });
  };

  const handlePointerMove = (
    e: React.PointerEvent<HTMLCanvasElement>,
    normX: number,
    normY: number,
  ) => {
    activePointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

    // Handle 2-finger pinch & pan
    if (activePointersRef.current.size >= 2) {
      const pts = Array.from(activePointersRef.current.values());
      const currentDist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      const ratio = currentDist / Math.max(10, pinchDistStartRef.current);
      const nextZoom = Math.max(1.0, Math.min(3.5, Math.round(pinchZoomStartRef.current * ratio * 100) / 100));

      const currentMid = {
        x: (pts[0].clientX + pts[1].clientX) / 2,
        y: (pts[0].clientY + pts[1].clientY) / 2,
      };
      const rawDeltaX = currentMid.x - pinchMidStartRef.current.x;
      const rawDeltaY = currentMid.y - pinchMidStartRef.current.y;
      const deltaX = isFlipped ? -rawDeltaX : rawDeltaX;
      const deltaY = isFlipped ? -rawDeltaY : rawDeltaY;

      const maxPan = nextZoom > 1.05 ? 600 * (nextZoom - 1) : 0;
      const nextPan =
        nextZoom <= 1.05
          ? { x: 0, y: 0 }
          : {
              x: Math.max(-maxPan, Math.min(maxPan, pinchPanStartRef.current.x + deltaX)),
              y: Math.max(-maxPan, Math.min(maxPan, pinchPanStartRef.current.y + deltaY)),
            };

      setZoom(nextZoom);
      setPan(nextPan);
      return;
    }

    // Handle single-finger pan mode
    if (singlePanStartRef.current) {
      const rawDeltaX = e.clientX - singlePanStartRef.current.clientX;
      const rawDeltaY = e.clientY - singlePanStartRef.current.clientY;
      const deltaX = isFlipped ? -rawDeltaX : rawDeltaX;
      const deltaY = isFlipped ? -rawDeltaY : rawDeltaY;
      const maxPan = zoom > 1.05 ? 600 * (zoom - 1) : 0;
      setPan({
        x: Math.max(-maxPan, Math.min(maxPan, singlePanStartRef.current.panX + deltaX)),
        y: Math.max(-maxPan, Math.min(maxPan, singlePanStartRef.current.panY + deltaY)),
      });
      return;
    }

    // Drawing stroke move
    if (segment?.phase !== 'LIVE' || !currentStrokeIdRef.current) return;
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
    const id = currentStrokeIdRef.current;
    const pt = { x: normX, y: normY };
    strokeBufferRef.current.push(pt);

    const nowTime = Date.now();
    // Flush buffer if 16 points or 50ms passed
    if (
      strokeBufferRef.current.length >= 16 ||
      nowTime - lastSendPointsTimeRef.current >= 50
    ) {
      const pointsToSend = [...strokeBufferRef.current];
      strokeBufferRef.current = [];
      lastSendPointsTimeRef.current = nowTime;
      optimisticStrokePoints(id, pointsToSend);
      send({ type: 'STROKE_POINTS', id, points: pointsToSend });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);

    if (activePointersRef.current.size < 2) {
      isPinchingRef.current = false;
    }

    if (singlePanStartRef.current) {
      singlePanStartRef.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      return;
    }

    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
    activePointerIdRef.current = null;
    if (!currentStrokeIdRef.current) return;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignored
    }

    const id = currentStrokeIdRef.current;
    currentStrokeIdRef.current = null;

    if (strokeBufferRef.current.length > 0) {
      const pointsToSend = [...strokeBufferRef.current];
      strokeBufferRef.current = [];
      optimisticStrokePoints(id, pointsToSend);
      send({ type: 'STROKE_POINTS', id, points: pointsToSend });
    }
    send({ type: 'STROKE_END', id });
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomStep = e.deltaY < 0 ? 0.25 : -0.25;
    setZoom((z) => {
      const next = Math.max(1.0, Math.min(3.5, Math.round((z + zoomStep) * 100) / 100));
      if (next <= 1.05) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  // --- Render phase overlays ---
  if (!segment) {
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
        Подключение к эфиру...
      </div>
    );
  }

  // 1. PREP PHASE
  if (segment.phase === 'PREP') {
    const isLeadWriter = playerId === segment.leadWriterId;
    return (
      <div
        style={{
          width: '100%',
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(circle at center, #1e293b 0%, #090d16 100%)',
          padding: '16px',
        }}
      >
        <div
          className="card"
          style={{
            width: '100%',
            maxWidth: '520px',
            border: '2px solid #ef4444',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.7)',
            padding: '24px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="badge badge-red">
              <span className="live-dot" />
              ПОДГОТОВКА СЮЖЕТА {segment.index + 1} / {segment.totalSegments}
            </div>
            <div
              className="badge badge-amber"
              style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Clock size={14} /> {timeLeft} с
            </div>
          </div>

          {isLeadWriter ? (
            <form onSubmit={handleSubmitHeadline} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <h2 style={{ margin: '0 0 6px 0', fontSize: '20px', fontWeight: 900 }}>
                  ✍️ Вы — ведущий сценарист сюжета!
                </h2>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                  Придумайте громкий, сенсационный заголовок для новости. Если не успеете — редакция подставит случайный.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="input-text"
                    placeholder="ВВЕДИТЕ ЗАГОЛОВОК СЮЖЕТА..."
                    maxLength={90}
                    value={headlineInput}
                    onChange={(e) => setHeadlineInput(e.target.value)}
                    style={{ flex: 1, fontWeight: 700, fontSize: '15px' }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleRandomHeadline}
                    title="Случайная идея"
                  >
                    <Dices size={18} />
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-lg"
                style={{ width: '100%', marginTop: '6px' }}
              >
                <Sparkles size={18} />
                Готово / В эфир! 🚀
              </button>
            </form>
          ) : (
            <div
              style={{
                textAlign: 'center',
                padding: '24px 12px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div className="live-dot" style={{ width: '16px', height: '16px' }} />
              <div>
                <h2 style={{ margin: '0 0 8px 0', fontSize: '22px', fontWeight: 900 }}>
                  Срочный выпуск готовится...
                </h2>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
                  Ведущий сценарист{' '}
                  <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>{segment.leadWriterName}</span>{' '}
                  придумывает заголовок сюжета #{segment.index + 1}
                </p>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                Эфир начнется через {timeLeft} секунд
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2. SPLASH PHASE
  if (segment.phase === 'SPLASH') {
    return (
      <div
        style={{
          width: '100%',
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(circle at center, #7f1d1d 0%, #090d16 80%)',
          padding: '20px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: '#ef4444',
            color: '#ffffff',
            padding: '6px 16px',
            borderRadius: '999px',
            fontWeight: 900,
            fontSize: '14px',
            letterSpacing: '2px',
            marginBottom: '16px',
            boxShadow: '0 0 24px rgba(239, 68, 68, 0.8)',
          }}
        >
          <Radio size={18} />
          СРОЧНЫЙ ВЫПУСК НОВОСТЕЙ
        </div>

        <div style={{ fontSize: '13px', color: '#fca5a5', fontWeight: 700, letterSpacing: '1px' }}>
          СЮЖЕТ #{segment.index + 1} ИЗ {segment.totalSegments}
        </div>

        <h1
          style={{
            fontSize: 'clamp(26px, 6vw, 44px)',
            fontWeight: 900,
            textTransform: 'uppercase',
            color: '#ffffff',
            maxWidth: '800px',
            lineHeight: '1.2',
            margin: '12px 0 20px 0',
            textShadow: '0 4px 20px rgba(0, 0, 0, 0.8)',
          }}
        >
          {segment.headline || 'ЭКСТРЕННЫЙ ВЫПУСК'}
        </h1>

        <div style={{ fontSize: '14px', color: 'var(--muted)' }}>
          Автор сюжета: <span style={{ color: '#ffffff', fontWeight: 700 }}>{segment.leadWriterName}</span>
        </div>

        <div style={{ marginTop: '24px', fontSize: '12px', color: '#f87171', fontWeight: 700 }}>
          ПРЯМОЙ ЭФИР ЧЕРЕЗ {timeLeft} СЕК...
        </div>
      </div>
    );
  }

  // 3. LIVE & FREEZE PHASES
  const isArtist = me?.role === 'artist';

  // --- LAYOUT A: ARTIST FULLSCREEN WORKSPACE ---
  if (isArtist) {
    return (
      <div className="artist-workspace">
        {flashActive && <div className="camera-flash-overlay" />}
        {/* Top Artist Toolbar */}
        <div className={`artist-toolbar ${isForcedBrush ? 'forced-brush-active' : ''}`}>
          {/* Status badge & topic for mobile sidebar */}
          <div className="artist-toolbar-status">
            <div className="badge badge-red" style={{ fontSize: '11px', padding: '2px 6px', flexShrink: 0 }}>
              <span className="live-dot" /> {timeLeft}с
            </div>
            <div className="artist-toolbar-topic" title={segment.headline}>
              {segment.headline || 'ПРЯМОЙ ЭФИР'}
            </div>
          </div>

          {isForcedBrush && (
            <div
              style={{
                background: '#ff10f0',
                color: '#000000',
                fontWeight: 900,
                fontSize: '11px',
                padding: '3px 8px',
                borderRadius: '4px',
                textAlign: 'center',
                letterSpacing: '0.5px',
              }}
            >
              ⚠️ РЕЖИССЕР ВКЛЮЧИЛ КИСЛОТНУЮ КИСТЬ! БЛОКИРОВКА {forcedBrushRemaining}С
            </div>
          )}

          <div
            className="artist-toolbar-inner"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px',
              overflowX: 'auto',
            }}
          >
            {/* Color swatches */}
            <div className="artist-color-picker" style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
              {ARTIST_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={isForcedBrush || segment.phase !== 'LIVE'}
                  onClick={() => {
                    setSelectedColor(c);
                    setBrushMode('stroke');
                    triggerHaptic(10);
                  }}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: c,
                    border: selectedColor === c && brushMode === 'stroke' ? '3px solid #06b6d4' : '1px solid #475569',
                    boxShadow: selectedColor === c ? '0 0 8px rgba(6, 182, 212, 0.6)' : 'none',
                    cursor: segment.phase === 'LIVE' ? 'pointer' : 'not-allowed',
                    padding: 0,
                  }}
                  title={c === '#FFFFFF' ? 'Ластик / Белый' : c}
                />
              ))}

              {/* Neon Rainbow brush tool */}
              <button
                type="button"
                disabled={isForcedBrush || segment.phase !== 'LIVE'}
                onClick={() => {
                  setSelectedColor('#RAINBOW');
                  setBrushMode('stroke');
                  triggerHaptic(12);
                }}
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: 'conic-gradient(#ef4444, #f59e0b, #10b981, #06b6d4, #8b5cf6, #ec4899, #ef4444)',
                  border: selectedColor === '#RAINBOW' && brushMode === 'stroke' ? '3px solid #ffffff' : '1px solid #475569',
                  boxShadow: selectedColor === '#RAINBOW' ? '0 0 10px rgba(6, 182, 212, 0.9)' : 'none',
                  cursor: segment.phase === 'LIVE' ? 'pointer' : 'not-allowed',
                  padding: 0,
                }}
                title="Неоновая радужная кисть"
              />
            </div>

            {/* Brush sizes */}
            <div
              className="artist-brush-sizes"
              style={{
                display: 'flex',
                background: 'var(--surface-2)',
                borderRadius: '6px',
                padding: '2px',
                gap: '2px',
                flexShrink: 0,
              }}
            >
              {(['thin', 'medium', 'thick'] as BrushSizeKey[]).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  disabled={isForcedBrush || segment.phase !== 'LIVE'}
                  onClick={() => {
                    setSelectedBrushSize(sz);
                    setBrushMode('stroke');
                    triggerHaptic(8);
                  }}
                  className="btn btn-sm"
                  style={{
                    padding: '4px 8px',
                    background: selectedBrushSize === sz && brushMode === 'stroke' ? 'var(--cyan)' : 'transparent',
                    color: selectedBrushSize === sz && brushMode === 'stroke' ? '#000' : 'var(--text)',
                    fontSize: '11px',
                    fontWeight: 700,
                  }}
                >
                  {sz === 'thin' ? '● Тонкая' : sz === 'medium' ? '●● Средняя' : '●●● Толстая'}
                </button>
              ))}
            </div>

            {/* Stamps drawer toggle */}
            <button
              type="button"
              className={`btn btn-sm ${brushMode === 'stamp' ? 'btn-accent' : 'btn-secondary'}`}
              disabled={segment.phase !== 'LIVE'}
              onClick={() => {
                triggerHaptic(8);
                setStampsDrawerOpen(!stampsDrawerOpen);
              }}
              style={{ flexShrink: 0 }}
            >
              <span>{selectedStamp.icon}</span>
              <span>Штампы</span>
            </button>

            {/* Undo */}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={segment.phase !== 'LIVE'}
              onClick={() => {
                triggerHaptic(8);
                send({ type: 'UNDO_LAST' });
              }}
              title="Отменить последний штрих"
              style={{ flexShrink: 0 }}
            >
              <Undo2 size={14} />
            </button>

            {/* Shield */}
            <button
              type="button"
              className={`btn btn-sm ${shieldRemaining > 0 ? 'btn-secondary' : 'btn-accent'}`}
              disabled={shieldRemaining > 0 || segment.phase !== 'LIVE'}
              onClick={() => {
                triggerHaptic(15);
                send({ type: 'USE_SHIELD' });
              }}
              title="Защитный экран: блокирует любые пакости саботажников на 4 секунды (откат 12с)"
              style={{ flexShrink: 0, fontWeight: 700 }}
            >
              🛡️ {shieldRemaining > 0 ? `${shieldRemaining}с` : 'Защита'}
            </button>

            {/* Wipers */}
            <button
              type="button"
              className={`btn btn-sm ${wipersRemaining > 0 ? 'btn-secondary' : 'btn-warning'}`}
              disabled={wipersRemaining > 0 || segment.phase !== 'LIVE'}
              onClick={() => {
                triggerHaptic(15);
                send({ type: 'USE_WIPERS' });
              }}
              title="Счистить все пакости дворниками (откат 7с)"
              style={{ flexShrink: 0 }}
            >
              🧹 {wipersRemaining > 0 ? `${wipersRemaining}с` : 'Дворники'}
            </button>

            {/* Sound toggle */}
            <button
              type="button"
              className="btn btn-secondary btn-icon btn-sm"
              onClick={toggleMute}
              title={muted ? 'Включить звук' : 'Выключить звук'}
              style={{ flexShrink: 0 }}
            >
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>

          {/* Stamps Drawer dropdown */}
          {stampsDrawerOpen && (
            <div className="artist-stamps-drawer">
              {STAMPS.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => {
                    setSelectedStamp(st);
                    setBrushMode('stamp');
                    setStampsDrawerOpen(false);
                  }}
                  className={`btn btn-sm ${selectedStamp.id === st.id && brushMode === 'stamp' ? 'btn-accent' : 'btn-secondary'}`}
                  style={{ gap: '4px', flexShrink: 0 }}
                >
                  <span>{st.icon}</span>
                  <span>{st.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Central Pure 16:9 Canvas Stage */}
        <div className="artist-canvas-stage">
          {/* Zoom and Pan floating controls */}
          <div className="artist-zoom-controls">
            <div className="badge badge-red" style={{ fontSize: '11px', padding: '2px 7px', flexShrink: 0 }}>
              <span className="live-dot" /> {timeLeft}с
            </div>
            <button
              type="button"
              onClick={() =>
                setZoom((z) => {
                  const next = Math.max(1.0, Math.round((z - 0.5) * 10) / 10);
                  if (next <= 1.05) setPan({ x: 0, y: 0 });
                  return next;
                })
              }
              disabled={zoom <= 1.0}
              className="btn btn-secondary btn-sm"
              style={{ padding: '2px 8px', fontSize: '13px', fontWeight: 900 }}
              title="Отдалить"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1.0);
                setPan({ x: 0, y: 0 });
              }}
              className="btn btn-secondary btn-sm"
              style={{ padding: '2px 6px', fontSize: '11px', fontWeight: 700, minWidth: '40px' }}
              title="Сбросить масштаб 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(3.5, Math.round((z + 0.5) * 10) / 10))}
              disabled={zoom >= 3.5}
              className="btn btn-secondary btn-sm"
              style={{ padding: '2px 8px', fontSize: '13px', fontWeight: 900 }}
              title="Приблизить"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setIsPanMode(!isPanMode)}
              className={`btn btn-sm ${isPanMode ? 'btn-accent' : 'btn-secondary'}`}
              style={{ padding: '2px 8px', fontSize: '11px' }}
              title={isPanMode ? 'Режим панорамы активен' : 'Включить режим перемещения холста'}
            >
              {isPanMode ? '✋ Панорама' : '✏️ Рисовать'}
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="btn btn-secondary btn-sm"
              style={{ padding: '2px 6px', fontSize: '11px' }}
              title={isFullscreen ? 'Обычный экран' : 'Во весь экран'}
            >
              {isFullscreen ? <Minimize size={13} /> : <Maximize size={13} />}
            </button>
          </div>

          <TvDisplay
            drawItems={snapshot.drawItems}
            sabotageItems={snapshot.sabotageItems}
            effects={snapshot.effects}
            clockOffsetMs={clockOffsetMs}
            reactions={reactions}
            showOverlays={false}
            zoom={zoom}
            pan={pan}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
          />
        </div>

        {/* Bottom Compact News & Ticker Zone */}
        <div className="artist-bottom-news">
          <div
            className="artist-bottom-headline"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <div
              style={{
                fontSize: '12px',
                fontWeight: 900,
                color: '#f8fafc',
                textTransform: 'uppercase',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {segment.headline || 'ПРЯМОЙ ЭФИР'}
            </div>

            <div
              className={`badge ${segment.phase === 'LIVE' ? 'badge-red' : 'badge-amber'}`}
              style={{ flexShrink: 0 }}
            >
              <span className="live-dot" />
              {segment.phase === 'LIVE' ? `ЭФИР: ${timeLeft}с` : 'ФИКСАЦИЯ СТОП-КАДРА'}
            </div>
          </div>

          <TickerBar messages={snapshot.ticker} headline={segment.headline} />
        </div>
      </div>
    );
  }

  // --- LAYOUT B: 55% TV / 45% CONSOLE FOR WRITER & SABOTEUR ---
  const isWriter = me?.role === 'writer';
  const isSaboteur = me?.role === 'saboteur';

  return (
    <div className="split-screen">
      {flashActive && <div className="camera-flash-overlay" />}
      {/* Top 55% TV Zone */}
      <div className="split-tv-zone" style={{ position: 'relative' }}>
        <button
          type="button"
          className="btn btn-secondary btn-icon btn-sm"
          onClick={toggleMute}
          title={muted ? 'Включить звук' : 'Выключить звук'}
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            zIndex: 40,
            background: 'rgba(18, 24, 38, 0.85)',
          }}
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <TvDisplay
          drawItems={snapshot.drawItems}
          sabotageItems={snapshot.sabotageItems}
          effects={snapshot.effects}
          clockOffsetMs={clockOffsetMs}
          reactions={reactions}
          headline={segment.headline}
          tickerMessages={snapshot.ticker}
          showOverlays={true}
          isTargeting={Boolean(targetingAbility)}
          onTargetClick={handleTargetClick}
          phaseBadge={segment.phase === 'LIVE' ? `LIVE ${timeLeft}с` : 'СТОП-КАДР'}
        />
      </div>

      {/* Bottom 45% Console Zone */}
      <div className="split-console-zone">
        {/* Targeting active notice for Saboteur */}
        {targetingAbility && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.25)',
              border: '1px solid #ef4444',
              borderRadius: '8px',
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#fca5a5' }}>
              <Crosshair size={14} className="live-dot" />
              <span>Тапните по экрану телевизора вверху, чтобы применить способность!</span>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ padding: '2px 8px', fontSize: '11px' }}
              onClick={() => setTargetingAbility(null)}
            >
              Отмена
            </button>
          </div>
        )}

        {/* 1. WRITER CONSOLE */}
        {isWriter && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: 800, fontSize: '13px', color: 'var(--cyan)' }}>
                ✍️ ПУЛЬТ СЦЕНАРИСТА • БЕГУЩАЯ СТРОКА
              </div>
              <div className="badge badge-cyan" style={{ fontSize: '10px' }}>
                Сюжет #{segment.index + 1}
              </div>
            </div>

            <form onSubmit={handleAddTicker} style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className="input-text"
                placeholder="Срочная новость в бегущую строку..."
                maxLength={80}
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                style={{ flex: 1, fontSize: '13px' }}
                disabled={segment.phase !== 'LIVE'}
              />
              <button
                type="submit"
                className="btn btn-accent btn-sm"
                disabled={!tickerInput.trim() || segment.phase !== 'LIVE'}
              >
                <Send size={14} /> В строку
              </button>
            </form>

            {/* Quick headline inject suggestions & starters */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[
                '⚡ СРОЧНО: ',
                '😱 ШОК: ',
                '👀 СВИДЕТЕЛИ: ',
                '🔬 УЧЕНЫЕ: ',
                '🔥 СЕНСАЦИЯ: ',
                '🚨 ВНИМАНИЕ: ',
              ].map((prefix) => (
                <button
                  key={prefix}
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                  disabled={segment.phase !== 'LIVE'}
                  onClick={() => {
                    triggerHaptic(8);
                    setTickerInput((prev) => (prev ? `${prefix}${prev}` : prefix));
                  }}
                >
                  {prefix}
                </button>
              ))}
            </div>

            {/* Writer Action Bar: Breaking News Alert & Anti-Hack */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                className={`btn btn-sm ${breakingNewsRemaining > 0 ? 'btn-secondary' : 'btn-warning'}`}
                disabled={breakingNewsRemaining > 0 || segment.phase !== 'LIVE'}
                onClick={() => {
                  triggerHaptic(15);
                  send({ type: 'USE_BREAKING_NEWS' });
                }}
                style={{ flex: 1, fontWeight: 800 }}
                title="МОЛНИЯ В КАДР: Экстренная плашка и сирена на весь экран прямого эфира (откат 12с)"
              >
                ⚡ {breakingNewsRemaining > 0 ? `Молния (${breakingNewsRemaining}с)` : 'Молния в кадр!'}
              </button>

              {snapshot.ticker.some((m) => m.hackedText) && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  style={{ fontWeight: 800, animation: 'pulse-live 1s infinite' }}
                  onClick={() => {
                    triggerHaptic(15);
                    send({ type: 'CLEAN_TICKER' });
                  }}
                  title="Анти-хак редактора: моментально очистить взломанные символы и восстановить текст строки"
                >
                  🛠️ Анти-хак: Очистить строку!
                </button>
              )}
            </div>
          </div>
        )}

        {/* 2. SABOTEUR CONSOLE */}
        {isSaboteur && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Header + Energy Bar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '16px' }}>
                    {me.saboteurClass ? SABOTEUR_CLASSES[me.saboteurClass].icon : '😈'}
                  </span>
                  <span style={{ fontWeight: 800, fontSize: '13px', color: '#f8fafc' }}>
                    {me.saboteurClass ? SABOTEUR_CLASSES[me.saboteurClass].name : 'Саботажник'}
                  </span>
                </div>
                <div style={{ fontWeight: 800, fontSize: '13px', color: 'var(--amber)' }}>
                  ⚡ {me.energy} / 100
                </div>
              </div>

              {/* Glowing Energy Progress bar */}
              <div
                style={{
                  width: '100%',
                  height: '8px',
                  background: 'var(--surface-2)',
                  borderRadius: '999px',
                  overflow: 'hidden',
                  border: '1px solid var(--border)',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, me.energy)}%`,
                    background: 'linear-gradient(90deg, #f59e0b 0%, #ef4444 100%)',
                    borderRadius: '999px',
                    transition: 'width 0.2s linear',
                    boxShadow: '0 0 8px rgba(245, 158, 11, 0.7)',
                  }}
                />
              </div>
            </div>

            {/* 4 Class Abilities (3 Core + 1 Special) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
              {me.saboteurClass &&
                [
                  ...SABOTEUR_CLASSES[me.saboteurClass].abilities,
                  SABOTEUR_CLASSES[me.saboteurClass].specialAbility,
                ].map((abId) => {
                  const ab = ABILITIES[abId];
                  const hasEnergy = me.energy >= ab.cost;
                  const isAiming = targetingAbility === abId;

                  return (
                    <button
                      key={abId}
                      type="button"
                      className="card"
                      disabled={!hasEnergy || segment.phase !== 'LIVE'}
                      onClick={() => {
                        triggerHaptic(12);
                        handleAbilityClick(abId);
                      }}
                      title={`${ab.name}: ${ab.shortDesc} (Стоимость: ${ab.cost}⚡)`}
                      style={{
                        padding: '8px 4px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '3px',
                        textAlign: 'center',
                        cursor: hasEnergy ? 'pointer' : 'not-allowed',
                        border: isAiming
                          ? '2px solid #ef4444'
                          : hasEnergy
                            ? '1px solid var(--amber)'
                            : '1px solid var(--border)',
                        background: isAiming
                          ? 'rgba(239, 68, 68, 0.25)'
                          : hasEnergy
                            ? 'var(--surface-2)'
                            : 'rgba(27, 36, 56, 0.4)',
                        opacity: hasEnergy && segment.phase === 'LIVE' ? 1 : 0.45,
                        boxShadow: hasEnergy ? '0 0 10px rgba(245, 158, 11, 0.25)' : 'none',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span style={{ fontSize: '20px' }}>{ab.icon}</span>
                      <div
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          lineHeight: '1.2',
                          color: '#f8fafc',
                        }}
                      >
                        {ab.name}
                      </div>
                      <div
                        style={{
                          fontSize: '9px',
                          color: 'var(--muted)',
                          lineHeight: '1.1',
                          maxWidth: '100%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {ab.shortDesc}
                      </div>
                      <div className="badge badge-amber" style={{ fontSize: '10px', padding: '1px 6px', marginTop: '2px' }}>
                        {ab.cost} ⚡
                      </div>
                    </button>
                  );
                })}
            </div>

            {/* Emoji Reactions Block */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                borderTop: '1px solid var(--border)',
                paddingTop: '8px',
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--muted)',
                  textTransform: 'uppercase',
                }}
              >
                Реакции зрителя (0 энергии):
              </div>

              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {/* 4 Quick Reactions */}
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="btn btn-secondary"
                    style={{
                      flex: 1,
                      fontSize: '20px',
                      padding: '6px 0',
                      borderRadius: '8px',
                    }}
                    onClick={() => handleSendReaction(emoji)}
                    disabled={segment.phase !== 'LIVE'}
                    title={`Отправить ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}

                {/* Custom Emoji 1-tap slot */}
                {customEmoji ? (
                  <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{
                        fontSize: '20px',
                        padding: '6px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--cyan)',
                      }}
                      onClick={() => handleSendReaction(customEmoji)}
                      disabled={segment.phase !== 'LIVE'}
                      title={`Отправить ${customEmoji}`}
                    >
                      {customEmoji}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-icon"
                      style={{ padding: '6px', color: 'var(--muted)' }}
                      onClick={() => setCustomEmojiEditing(true)}
                      title="Сменить эмодзи"
                    >
                      <Edit2 size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setCustomEmojiEditing(true)}
                  >
                    <SmilePlus size={14} /> + Свой
                  </button>
                )}
              </div>

              {/* Custom Emoji Editor Modal / Inline form */}
              {customEmojiEditing && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                  <form
                    onSubmit={handleSaveCustomEmoji}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: 'var(--surface-2)',
                      padding: '6px',
                      borderRadius: '8px',
                    }}
                  >
                    <input
                      type="text"
                      className="input-text"
                      placeholder="Введите ровно 1 эмодзи..."
                      maxLength={16}
                      value={customEmojiInput}
                      onChange={(e) => {
                        setCustomEmojiInput(e.target.value);
                        setCustomEmojiError(false);
                      }}
                      style={{
                        flex: 1,
                        fontSize: '14px',
                        padding: '6px 8px',
                        borderColor: customEmojiError ? '#ef4444' : undefined,
                      }}
                      autoFocus
                    />
                    <button type="submit" className="btn btn-accent btn-sm">
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setCustomEmojiEditing(false);
                        setCustomEmojiError(false);
                      }}
                    >
                      ✕
                    </button>
                  </form>
                  {customEmojiError && (
                    <div style={{ fontSize: '11px', color: '#ef4444', paddingLeft: '4px' }}>
                      Требуется ровно 1 эмодзи (без текста и символов)
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 3. SPECTATOR CONSOLE (if no role) */}
        {!isWriter && !isSaboteur && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--muted)' }}>
              РЕЖИМ ЗРИТЕЛЯ • ОТПРАВИТЬ РЕАКЦИЮ
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1, fontSize: '22px', padding: '8px 0' }}
                  onClick={() => handleSendReaction(emoji)}
                  disabled={segment.phase !== 'LIVE'}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
