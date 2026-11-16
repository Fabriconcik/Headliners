import type { TickerMessage } from '@shared/protocol';

interface Props {
  messages: TickerMessage[];
  headline?: string;
}

export function TickerBar({ messages, headline }: Props) {
  const displayItems: TickerMessage[] = [];

  if (headline) {
    displayItems.push({
      id: 'lead-headline',
      authorName: 'ГЛАВНОЕ',
      text: headline,
      createdAt: 0,
    });
  }

  if (messages && messages.length > 0) {
    displayItems.push(...messages);
  } else if (!headline) {
    displayItems.push({
      id: 'default',
      authorName: 'РЕДАКЦИЯ',
      text: 'ЭКСТРЕННЫЙ ВЫПУСК В ПРЯМОМ ЭФИРЕ • СЛЕДИТЕ ЗА СОБЫТИЯМИ В СТУДИИ',
      createdAt: 0,
    });
  }

  // Ensure content track is long enough so marquee never leaves gaps on wide screens
  let baseItems = [...displayItems];
  while (baseItems.length < 8) {
    baseItems = [...baseItems, ...displayItems];
  }

  // Dynamic animation speed proportional to text length for comfortable reading
  const totalChars = baseItems.reduce(
    (acc, m) => acc + (m.hackedText || m.text).length + m.authorName.length,
    0,
  );
  const durationSec = Math.max(18, Math.min(80, Math.round(totalChars * 0.18)));

  const renderItem = (m: TickerMessage, idx: number, keyPrefix: string) => {
    const isHacked = Boolean(m.hackedText);
    const text = isHacked ? m.hackedText : m.text;
    const isLead = m.id === 'lead-headline';

    return (
      <span
        key={`${keyPrefix}-${m.id}-${idx}-${m.hackedText ?? ''}`}
        style={{
          color: isHacked ? '#facc15' : isLead ? '#38bdf8' : '#f8fafc',
          textShadow: isHacked
            ? '0 0 6px rgba(250, 204, 21, 0.6)'
            : isLead
              ? '0 0 6px rgba(56, 189, 248, 0.4)'
              : undefined,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          fontWeight: isLead ? 800 : 600,
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
        <span
          style={{
            color: isLead ? '#38bdf8' : '#94a3b8',
            fontWeight: 700,
            textTransform: 'uppercase',
            fontSize: '11px',
          }}
        >
          {m.authorName}:
        </span>
        <span style={{ letterSpacing: '0.2px' }}>{text}</span>
        <span style={{ color: '#475569', margin: '0 4px', fontSize: '9px' }}>◆</span>
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

      <div className="ticker-track-wrapper">
        <div
          className="ticker-marquee-track"
          style={{ animationDuration: `${durationSec}s` }}
        >
          <div className="ticker-marquee-content">
            {baseItems.map((m, idx) => renderItem(m, idx, 'a'))}
          </div>
          <div className="ticker-marquee-content" aria-hidden="true">
            {baseItems.map((m, idx) => renderItem(m, idx, 'b'))}
          </div>
        </div>
      </div>
    </div>
  );
}
