import type { TickerMessage } from '@shared/protocol';

interface Props {
  messages: TickerMessage[];
}

export function TickerBar({ messages }: Props) {
  const displayItems =
    messages.length > 0
      ? messages.slice(-8)
      : [
          {
            id: 'default',
            authorName: 'РЕДАКЦИЯ',
            text: 'ЭКСТРЕННЫЙ ВЫПУСК В ПРЯМОМ ЭФИРЕ • СЛЕДИТЕ ЗА СОБЫТИЯМИ В СТУДИИ',
            createdAt: 0,
          },
        ];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: '#090d16',
        color: '#f8fafc',
        height: '28px',
        overflow: 'hidden',
        borderTop: '2px solid #ef4444',
        fontSize: '12px',
        fontWeight: 700,
        position: 'relative',
        width: '100%',
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
          flexShrink: 0,
          zIndex: 2,
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
        />
        МОЛНИЯ
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          paddingLeft: '12px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1,
        }}
        className="ticker-animate"
      >
        {displayItems.map((m, idx) => {
          const isHacked = Boolean(m.hackedText);
          const text = isHacked ? m.hackedText : m.text;
          return (
            <span
              key={m.id + (m.hackedText ?? '') + idx}
              style={{
                color: isHacked ? '#facc15' : '#f8fafc',
                textShadow: isHacked ? '0 0 6px rgba(250, 204, 21, 0.6)' : undefined,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {isHacked && <span style={{ color: '#ef4444', fontSize: '10px' }}>[ВЗЛОМ]</span>}
              <span style={{ color: '#94a3b8', fontWeight: 500 }}>{m.authorName}:</span>
              <span>{text}</span>
              {idx < displayItems.length - 1 && <span style={{ color: '#475569' }}>◆</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
