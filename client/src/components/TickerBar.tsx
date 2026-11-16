import { useEffect, useRef, useState } from 'react';
import type { TickerMessage } from '@shared/protocol';

interface Props {
  messages: TickerMessage[];
  headline?: string;
}

interface TrackItem {
  uid: string;
  msgId: string;
  authorName: string;
  text: string;
  hackedText?: string;
  isLead?: boolean;
  isFresh: boolean;
}

const SPEED_PX_PER_SEC = 90; // Accelerated dynamic speed (~85-95 px/sec) to maximize visible updates

function getPlaylist(messages: TickerMessage[], headline?: string): TickerMessage[] {
  const items: TickerMessage[] = [];
  if (headline) {
    items.push({
      id: 'lead-headline',
      authorName: 'ГЛАВНОЕ',
      text: headline,
      createdAt: 0,
    });
  }
  if (messages && messages.length > 0) {
    items.push(...messages);
  } else if (!headline) {
    items.push({
      id: 'default',
      authorName: 'РЕДАКЦИЯ',
      text: 'ЭКСТРЕННЫЙ ВЫПУСК В ПРЯМОМ ЭФИРЕ • СЛЕДИТЕ ЗА СОБЫТИЯМИ В СТУДИИ',
      createdAt: 0,
    });
  }
  return items;
}

export function TickerBar({ messages, headline }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);

  // References to track current props across RAF without re-binding loops
  const messagesRef = useRef<TickerMessage[]>(messages);
  messagesRef.current = messages;
  const headlineRef = useRef<string | undefined>(headline);
  headlineRef.current = headline;

  // Running scroll offset in pixels
  const scrollXRef = useRef<number>(0);
  const isHoveredRef = useRef<boolean>(false);
  const itemSeqRef = useRef<number>(1);
  const playlistIdxRef = useRef<number>(0);

  // IDs of messages seen so far
  const seenIdsRef = useRef<Set<string>>(new Set());
  const isFirstMountRef = useRef<boolean>(true);

  // Pad on the left to allow seamless trimming of off-screen DOM nodes
  const [padLeft, setPadLeft] = useState<number>(0);
  const padLeftRef = useRef<number>(0);
  padLeftRef.current = padLeft;

  // Items currently rendered on the track
  const [trackItems, setTrackItems] = useState<TrackItem[]>(() => {
    const playlist = getPlaylist(messages, headline);
    const initial: TrackItem[] = [];
    let seq = 1;
    // Pre-fill enough items to comfortably cover any initial viewport (~1500px)
    if (playlist.length > 0) {
      while (initial.length < 4) {
        for (const m of playlist) {
          const isFresh = m.createdAt > 0 && Date.now() - m.createdAt < 3000;
          initial.push({
            uid: `init-${m.id}-${seq++}`,
            msgId: m.id,
            authorName: m.authorName,
            text: m.text,
            hackedText: m.hackedText,
            isLead: m.id === 'lead-headline',
            isFresh,
          });
        }
      }
    }
    return initial;
  });

  const trackItemsRef = useRef<TrackItem[]>(trackItems);
  trackItemsRef.current = trackItems;

  // Handle new messages and hacks from parent
  const prevHeadlineRef = useRef<string | undefined>(headline);
  useEffect(() => {
    // 1. Check if headline changed (new segment started with empty messages)
    if (headline !== prevHeadlineRef.current) {
      prevHeadlineRef.current = headline;
      if (!messages || messages.length === 0) {
        // Reset ticker for new segment
        scrollXRef.current = 0;
        padLeftRef.current = 0;
        if (spacerRef.current) {
          spacerRef.current.style.width = '0px';
        }
        if (trackRef.current) {
          trackRef.current.style.transform = 'translate3d(0px, 0, 0)';
        }
        setPadLeft(0);
        seenIdsRef.current.clear();
        playlistIdxRef.current = 0;

        const playlist = getPlaylist([], headline);
        const resetItems: TrackItem[] = [];
        let seq = 1;
        if (playlist.length > 0) {
          while (resetItems.length < 4) {
            for (const m of playlist) {
              resetItems.push({
                uid: `seg-${m.id}-${seq++}`,
                msgId: m.id,
                authorName: m.authorName,
                text: m.text,
                hackedText: m.hackedText,
                isLead: m.id === 'lead-headline',
                isFresh: false,
              });
            }
          }
        }
        trackItemsRef.current = resetItems;
        setTrackItems(resetItems);
        return;
      }
    }

    // 2. Initialize seen IDs on initial mount
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      for (const m of messages) {
        seenIdsRef.current.add(m.id);
      }
      return;
    }

    // 3. Detect newly arriving ticker messages (e.g. writer sent new script)
    const newlyAdded: TickerMessage[] = [];
    for (const m of messages) {
      if (!seenIdsRef.current.has(m.id)) {
        seenIdsRef.current.add(m.id);
        newlyAdded.push(m);
      }
    }

    // 4. Also check if any message was hacked OR un-hacked (Anti-Hack clean)
    let hackUpdated = false;
    for (const item of trackItemsRef.current) {
      const liveMsg = messages.find((m) => m.id === item.msgId);
      if (liveMsg && item.hackedText !== liveMsg.hackedText) {
        item.hackedText = liveMsg.hackedText;
        hackUpdated = true;
      }
      if (liveMsg && item.text !== liveMsg.text) {
        item.text = liveMsg.text;
        hackUpdated = true;
      }
    }

    // If new messages were added, insert them promptly right behind visible/entering items
    // so they enter smoothly from the right edge with zero jump and minimal delay!
    if (newlyAdded.length > 0) {
      const newItems: TrackItem[] = newlyAdded.map((m) => ({
        uid: `fresh-${m.id}-${itemSeqRef.current++}`,
        msgId: m.id,
        authorName: m.authorName,
        text: m.text,
        hackedText: m.hackedText,
        isLead: false,
        isFresh: true, // Marked fresh on its first pass!
      }));

      const containerEl = containerRef.current;
      const trackEl = trackRef.current;
      const viewportWidth = containerEl?.clientWidth || 800;
      const visibleRightEdge = scrollXRef.current + viewportWidth;

      // Find cut point: keep all items that are visible or entering the right edge (within 80px)
      let insertIdx = trackItemsRef.current.length;
      if (trackEl && trackEl.children.length === trackItemsRef.current.length + 1) {
        for (let i = 0; i < trackItemsRef.current.length; i++) {
          const child = trackEl.children[i + 1] as HTMLElement;
          if (child && child.offsetLeft > visibleRightEdge + 60) {
            insertIdx = i;
            break;
          }
        }
      }

      const head = trackItemsRef.current.slice(0, insertIdx);
      const tail = trackItemsRef.current.slice(insertIdx, insertIdx + 3);
      trackItemsRef.current = [...head, ...newItems, ...tail];
      setTrackItems([...trackItemsRef.current]);
    } else if (hackUpdated) {
      setTrackItems([...trackItemsRef.current]);
    }
  }, [messages, headline]);

  // RequestAnimationFrame smooth scrolling engine
  useEffect(() => {
    let rafId: number;
    let lastTime = performance.now();
    let lastCheckTime = performance.now();

    const loop = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // Scroll unless paused by hover
      if (!isHoveredRef.current) {
        scrollXRef.current += SPEED_PX_PER_SEC * dt;
        if (trackRef.current) {
          trackRef.current.style.transform = `translate3d(-${scrollXRef.current}px, 0, 0)`;
        }
      }

      // Throttle DOM measurements / buffer checks to every ~180ms
      if (now - lastCheckTime > 180) {
        lastCheckTime = now;

        const trackEl = trackRef.current;
        const containerEl = containerRef.current;

        if (trackEl && containerEl) {
          const viewportWidth = containerEl.clientWidth || 800;
          const trackWidth = trackEl.scrollWidth;
          const remaining = trackWidth - scrollXRef.current;

          // A. Append next items to track when buffer ahead runs low
          if (remaining < viewportWidth + 600) {
            const playlist = getPlaylist(messagesRef.current, headlineRef.current);
            if (playlist.length > 0) {
              const nextMsg = playlist[playlistIdxRef.current % playlist.length];
              playlistIdxRef.current++;

              const nextItem: TrackItem = {
                uid: `loop-${nextMsg.id}-${itemSeqRef.current++}`,
                msgId: nextMsg.id,
                authorName: nextMsg.authorName,
                text: nextMsg.text,
                hackedText: nextMsg.hackedText,
                isLead: nextMsg.id === 'lead-headline',
                isFresh: false, // Looped copies are NEVER fresh; first pass already completed
              };

              trackItemsRef.current = [...trackItemsRef.current, nextItem];
              setTrackItems([...trackItemsRef.current]);
            }
          }

          // B. Trim items that have scrolled far off-screen to the left (> 120px off-screen)
          // to keep DOM memory strictly bounded without ANY visual shift.
          if (
            trackItemsRef.current.length > 6 &&
            trackEl.children.length === trackItemsRef.current.length + 1
          ) {
            const firstChild = trackEl.children[1] as HTMLElement;
            const secondChild = trackEl.children[2] as HTMLElement;
            if (firstChild && secondChild) {
              const itemRight = firstChild.offsetLeft + firstChild.offsetWidth;
              if (itemRight < scrollXRef.current - 120) {
                const itemWidth = secondChild.offsetLeft - firstChild.offsetLeft;
                padLeftRef.current += itemWidth;
                if (spacerRef.current) {
                  spacerRef.current.style.width = `${padLeftRef.current}px`;
                }
                trackItemsRef.current = trackItemsRef.current.slice(1);
                setPadLeft(padLeftRef.current);
                setTrackItems([...trackItemsRef.current]);
              }
            }
          }
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, []);

  const renderItem = (item: TrackItem) => {
    const isHacked = Boolean(item.hackedText);
    const text = isHacked ? item.hackedText : item.text;
    const isLead = item.isLead || item.msgId === 'lead-headline';
    const isFresh = item.isFresh && !isHacked;

    return (
      <span
        key={item.uid}
        style={{
          color: isHacked ? '#facc15' : isFresh ? '#fde047' : isLead ? '#38bdf8' : '#f8fafc',
          textShadow: isHacked
            ? '0 0 6px rgba(250, 204, 21, 0.6)'
            : isFresh
              ? '0 0 8px rgba(250, 204, 21, 0.7)'
              : isLead
                ? '0 0 6px rgba(56, 189, 248, 0.4)'
                : undefined,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          fontWeight: isLead ? 800 : isFresh ? 700 : 600,
          flexShrink: 0,
        }}
      >
        {isHacked && (
          <span
            style={{
              background: '#ef4444',
              color: '#ffffff',
              fontSize: '9px',
              padding: '1px 4px',
              borderRadius: '3px',
              fontWeight: 900,
              letterSpacing: '0.5px',
            }}
          >
            ВЗЛОМ
          </span>
        )}

        {isFresh && (
          <span
            className="ticker-badge-new"
            title="Новое сообщение"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#facc15',
              color: '#090d16',
              fontSize: '10px',
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              fontWeight: 900,
              boxShadow: '0 0 8px rgba(250, 204, 21, 0.85), 0 0 2px #fff',
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            ⚡
          </span>
        )}

        <span
          style={{
            color: isLead ? '#38bdf8' : isFresh ? '#fde047' : '#94a3b8',
            fontWeight: 700,
            textTransform: 'uppercase',
            fontSize: '11px',
          }}
        >
          {item.authorName}:
        </span>
        <span style={{ letterSpacing: '0.2px' }}>{text}</span>
        <span
          style={{
            color: isFresh ? '#eab308' : '#475569',
            margin: '0 4px',
            fontSize: '9px',
          }}
        >
          ◆
        </span>
      </span>
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: '#090d16',
        color: '#f8fafc',
        height: '26px',
        overflow: 'hidden',
        borderTop: '2px solid #ef4444',
        fontSize: '11px',
        position: 'relative',
        width: '100%',
        userSelect: 'none',
      }}
      onMouseEnter={() => {
        isHoveredRef.current = true;
      }}
      onMouseLeave={() => {
        isHoveredRef.current = false;
      }}
    >
      <div
        style={{
          background: '#ef4444',
          color: '#ffffff',
          padding: '0 8px',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          letterSpacing: '0.5px',
          fontSize: '10px',
          textTransform: 'uppercase',
          fontWeight: 900,
          flexShrink: 0,
          zIndex: 2,
          boxShadow: '2px 0 6px rgba(0,0,0,0.4)',
        }}
      >
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#ffffff',
            display: 'inline-block',
          }}
          className="live-dot"
        />
        МОЛНИЯ
      </div>

      <div className="ticker-track-wrapper" ref={containerRef}>
        <div
          ref={trackRef}
          className="ticker-marquee-track"
          style={{
            position: 'relative',
            transform: `translate3d(-${scrollXRef.current}px, 0, 0)`,
          }}
        >
          <div ref={spacerRef} style={{ width: `${padLeft}px`, flexShrink: 0 }} />
          {trackItems.map((item) => renderItem(item))}
        </div>
      </div>
    </div>
  );
}
