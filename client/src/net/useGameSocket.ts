import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  C2SMessage,
  PointNorm,
  RoomStateSnapshot,
  S2CMessage,
} from '@shared/protocol';
import { sfx } from '../audio/sfx';

export interface FloatingReaction {
  id: string;
  emoji: string;
  lane: number; // 0..1
  createdAt: number;
}

const STORAGE_TOKEN_KEY = 'news_chaos_token';
const STORAGE_ROOM_KEY = 'news_chaos_room';
const STORAGE_NAME_KEY = 'news_chaos_name';

export function getSavedSession(): { token: string; roomCode: string; name: string } {
  return {
    token: sessionStorage.getItem(STORAGE_TOKEN_KEY) ?? '',
    roomCode: sessionStorage.getItem(STORAGE_ROOM_KEY) ?? '',
    name: sessionStorage.getItem(STORAGE_NAME_KEY) ?? '',
  };
}

export function useGameSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const playerIdRef = useRef<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RoomStateSnapshot | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);

  const lastPhaseRef = useRef<string | null>(null);
  // Messages typed while the socket is still opening must not be lost.
  const pendingSendsRef = useRef<C2SMessage[]>([]);
  // Strokes whose points were applied locally; their server echo is a duplicate.
  const optimisticStrokeIdsRef = useRef<Set<string>>(new Set());
  const reconnectAttemptsRef = useRef(0);

  const pushReaction = useCallback((id: string, emoji: string, lane: number) => {
    setReactions((prev) => [...prev.slice(-18), { id, emoji, lane, createdAt: Date.now() }]);
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2100);
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    let openedAt = 0;

    ws.onopen = () => {
      openedAt = Date.now();
      setConnected(true);
      const saved = getSavedSession();
      if (saved.roomCode && saved.token) {
        ws.send(
          JSON.stringify({
            type: 'RECONNECT',
            roomCode: saved.roomCode,
            token: saved.token,
          } satisfies C2SMessage),
        );
      }
      const pending = pendingSendsRef.current;
      pendingSendsRef.current = [];
      for (const queued of pending) {
        ws.send(JSON.stringify(queued));
      }
    };

    ws.onerror = () => {
      // The close handler below owns the reconnect logic.
    };

    ws.onclose = () => {
      setConnected(false);
      // Only short-lived flaps grow the backoff. Two tabs sharing one token keep
      // kicking each other out; without this they would reconnect forever at the
      // same 600 ms cadence instead of backing off.
      if (openedAt !== 0 && Date.now() - openedAt > 2_000) {
        reconnectAttemptsRef.current = 0;
      }
      const attempt = reconnectAttemptsRef.current++;
      const base = Math.min(5_000, 600 * 2 ** Math.min(attempt, 4));
      const delay = Math.round(base * (0.75 + Math.random() * 0.5));
      setTimeout(() => {
        if (wsRef.current === ws) {
          wsRef.current = null;
          connect();
        }
      }, delay);
    };

    ws.onmessage = (ev) => {
      let msg: S2CMessage;
      try {
        msg = JSON.parse(String(ev.data)) as S2CMessage;
      } catch {
        return;
      }

      if (msg.type === 'ERROR') {
        // A dead session must not be retried forever on every reconnect. Only clear
        // the saved session for "room/session is gone" errors, not for a full room.
        const staleSession =
          msg.message.includes('не найдена') || msg.message.includes('больше не существует');
        if (staleSession) {
          sessionStorage.removeItem(STORAGE_TOKEN_KEY);
          sessionStorage.removeItem(STORAGE_ROOM_KEY);
        }
        setErrorMsg(msg.message);
        setTimeout(() => setErrorMsg((cur) => (cur === msg.message ? null : cur)), 3500);
        return;
      }

      if (msg.type === 'WELCOME') {
        playerIdRef.current = msg.playerId;
        setPlayerId(msg.playerId);
        sessionStorage.setItem(STORAGE_TOKEN_KEY, msg.token);
        sessionStorage.setItem(STORAGE_ROOM_KEY, msg.snapshot.roomCode);
        setClockOffsetMs(msg.snapshot.serverNow - Date.now());
        setSnapshot(msg.snapshot);
        return;
      }

      if (msg.type === 'STATE_SYNC') {
        setClockOffsetMs(msg.snapshot.serverNow - Date.now());
        const phaseKey = msg.snapshot.segment
          ? `${msg.snapshot.segment.index}:${msg.snapshot.segment.phase}`
          : msg.snapshot.screen;
        if (lastPhaseRef.current !== phaseKey) {
          lastPhaseRef.current = phaseKey;
          if (msg.snapshot.segment?.phase === 'SPLASH') sfx.playNewsJingle();
          if (msg.snapshot.segment?.phase === 'FREEZE') sfx.playShutter();
        }
        setSnapshot(msg.snapshot);
        return;
      }

      if (msg.type === 'ENERGY_UPDATE') {
        setClockOffsetMs(msg.serverNow - Date.now());
        setSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            players: prev.players.map((p) =>
              p.id === playerIdRef.current ? { ...p, energy: msg.energy } : p,
            ),
          };
        });
        return;
      }

      if (msg.type === 'STROKE_START_BC') {
        setSnapshot((prev) => {
          if (!prev) return prev;
          const existing = prev.drawItems.find((d) => d.id === msg.item.id);
          if (!existing) {
            return { ...prev, drawItems: [...prev.drawItems, msg.item] };
          }
          // Own optimistic stroke: keep the locally accumulated points but adopt
          // the server-authoritative brush (forced_brush clamps color and width).
          if (existing.authorId !== playerIdRef.current || existing.kind !== 'stroke') {
            return prev;
          }
          return {
            ...prev,
            drawItems: prev.drawItems.map((d) =>
              d.kind === 'stroke' && d.id === msg.item.id
                ? { ...d, color: msg.item.color, widthNorm: msg.item.widthNorm }
                : d,
            ),
          };
        });
        return;
      }

      if (msg.type === 'STROKE_POINTS_BC') {
        // The stroke author already appended these points optimistically; applying
        // the echo again would duplicate every point of the stroke.
        if (optimisticStrokeIdsRef.current.has(msg.id)) return;
        setSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            drawItems: prev.drawItems.map((d) =>
              d.kind === 'stroke' && d.id === msg.id
                ? { ...d, points: [...d.points, ...msg.points] }
                : d,
            ),
          };
        });
        return;
      }

      if (msg.type === 'STAMP_ADD_BC') {
        sfx.playPop();
        setSnapshot((prev) => {
          if (!prev) return prev;
          if (prev.drawItems.some((d) => d.id === msg.item.id)) return prev;
          return { ...prev, drawItems: [...prev.drawItems, msg.item] };
        });
        return;
      }

      if (msg.type === 'UNDO_BC') {
        setSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            drawItems: prev.drawItems.filter((d) => d.id !== msg.itemId),
          };
        });
        return;
      }

      if (msg.type === 'WIPERS_BC') {
        sfx.playWipers();
        setSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            sabotageItems: [],
            effects: { ...prev.effects, wipersAnimUntil: msg.animUntil },
            players: prev.players.map((p) =>
              p.id === msg.actorId ? { ...p, wipersCooldownUntil: msg.cooldownUntil } : p,
            ),
          };
        });
        return;
      }

      if (msg.type === 'SHIELD_BC') {
        sfx.playShield();
        setSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            effects: { ...prev.effects, shieldUntil: msg.shieldUntil },
            players: prev.players.map((p) =>
              p.id === msg.actorId ? { ...p, shieldCooldownUntil: msg.cooldownUntil } : p,
            ),
          };
        });
        return;
      }

      if (msg.type === 'BREAKING_NEWS_BC') {
        sfx.playBreakingNews();
        setSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            effects: {
              ...prev.effects,
              breakingNewsUntil: msg.until,
              breakingNewsAuthor: msg.authorName,
            },
            players: prev.players.map((p) =>
              p.id === msg.actorId ? { ...p, breakingNewsCooldownUntil: msg.cooldownUntil } : p,
            ),
          };
        });
        return;
      }

      if (msg.type === 'TICKER_CLEAN_BC') {
        sfx.playClean();
        setSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            ticker: prev.ticker.map((m) => {
              if (m.hackedText) {
                const copy = { ...m };
                delete copy.hackedText;
                return copy;
              }
              return m;
            }),
          };
        });
        return;
      }

      if (msg.type === 'SABOTAGE_VISUAL_BC') {
        sfx.playSplat();
        setSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            sabotageItems: [...prev.sabotageItems, msg.item],
          };
        });
        return;
      }

      if (msg.type === 'SABOTAGE_FX_BC') {
        if (msg.fx === 'static') sfx.playStatic();
        else if (msg.fx === 'shake') sfx.playRumble();
        else sfx.playGlitch();

        setSnapshot((prev) => {
          if (!prev) return prev;
          const nextEffects = { ...prev.effects };
          if (msg.fx === 'glitch') nextEffects.glitchUntil = msg.until;
          if (msg.fx === 'flip') nextEffects.flippedUntil = msg.until;
          if (msg.fx === 'forced_brush') nextEffects.forcedBrushUntil = msg.until;
          if (msg.fx === 'static') nextEffects.staticNoiseUntil = msg.until;
          if (msg.fx === 'shake') nextEffects.shakeUntil = msg.until;
          return { ...prev, effects: nextEffects };
        });
        return;
      }

      if (msg.type === 'TICKER_ADD_BC') {
        sfx.playPop();
        setSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            ticker: [...prev.ticker.slice(-20), msg.message],
          };
        });
        return;
      }

      if (msg.type === 'TICKER_HACK_BC') {
        sfx.playGlitch();
        setSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            ticker: prev.ticker.map((m) =>
              m.id === msg.id ? { ...m, hackedText: msg.hackedText } : m,
            ),
          };
        });
        return;
      }

      if (msg.type === 'REACTION_BC') {
        pushReaction(msg.id, msg.emoji, msg.lane);
      }
    };
  }, [pushReaction]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        const ws = wsRef.current;
        wsRef.current = null;
        ws.close();
      }
    };
  }, [connect]);

  const send = useCallback((msg: C2SMessage) => {
    if (msg.type === 'CREATE_ROOM' || msg.type === 'JOIN_ROOM') {
      sessionStorage.setItem(STORAGE_NAME_KEY, msg.playerName);
    }
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
      return;
    }
    // The socket may still be opening or reconnecting: queue instead of dropping.
    if (pendingSendsRef.current.length < 32) {
      pendingSendsRef.current.push(msg);
    }
  }, []);

  const clearSavedRoom = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'LEAVE_ROOM' } satisfies C2SMessage));
    }
    pendingSendsRef.current = [];
    optimisticStrokeIdsRef.current.clear();
    sessionStorage.removeItem(STORAGE_ROOM_KEY);
    sessionStorage.removeItem(STORAGE_TOKEN_KEY);
    playerIdRef.current = null;
    setSnapshot(null);
    setPlayerId(null);
  }, []);

  // Optimistic local stroke update for zero-latency finger drawing
  const optimisticStrokeStart = useCallback(
    (id: string, authorId: string, color: string, widthNorm: number, point: PointNorm) => {
      optimisticStrokeIdsRef.current.add(id);
      if (optimisticStrokeIdsRef.current.size > 512) optimisticStrokeIdsRef.current.clear();
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          drawItems: [
            ...prev.drawItems,
            { kind: 'stroke', id, authorId, color, widthNorm, points: [point] },
          ],
        };
      });
    },
    [],
  );

  const optimisticStrokePoints = useCallback((id: string, points: PointNorm[]) => {
    if (points.length === 0) return;
    setSnapshot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        drawItems: prev.drawItems.map((d) =>
          d.kind === 'stroke' && d.id === id ? { ...d, points: [...d.points, ...points] } : d,
        ),
      };
    });
  }, []);

  return {
    connected,
    playerId,
    snapshot,
    errorMsg,
    clockOffsetMs,
    reactions,
    pushReaction,
    send,
    clearSavedRoom,
    optimisticStrokeStart,
    optimisticStrokePoints,
  };
}
