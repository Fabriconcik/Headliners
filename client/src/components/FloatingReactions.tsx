import type { FloatingReaction } from '../net/useGameSocket';

interface Props {
  reactions: FloatingReaction[];
}

export function FloatingReactions({ reactions }: Props) {
  if (reactions.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 30,
      }}
    >
      {reactions.map((r) => {
        // Floating along screen edges (3%..15% left edge, 83%..95% right edge)
        // Leaving the central 70% canvas free for viewing artwork
        const isLeft = r.lane < 0.5;
        const normalized = isLeft ? r.lane / 0.5 : (r.lane - 0.5) / 0.5;
        const leftPct = isLeft ? 3 + normalized * 12 : 83 + normalized * 12;
        return (
          <div
            key={r.id}
            className="reaction-bubble"
            style={{
              left: `${leftPct}%`,
            }}
          >
            {r.emoji}
          </div>
        );
      })}
    </div>
  );
}
