import { useState, useEffect } from 'react';
import { Clock, Skull, CheckCircle2 } from 'lucide-react';
import type { RoomStateSnapshot, C2SMessage } from '@shared/protocol';
import {
  SABOTEUR_CLASSES,
  type Role,
  type SaboteurClass,
} from '@shared/constants';

interface Props {
  snapshot: RoomStateSnapshot;
  playerId: string | null;
  clockOffsetMs: number;
  send: (msg: C2SMessage) => void;
}

export function RoleSelectScreen({ snapshot, playerId, clockOffsetMs, send }: Props) {
  const me = snapshot.players.find((p) => p.id === playerId);
  const [timeLeft, setTimeLeft] = useState(15);

  useEffect(() => {
    const updateTimer = () => {
      const now = Date.now() + clockOffsetMs;
      const left = Math.max(0, Math.ceil((snapshot.roleSelectEndsAt - now) / 1000));
      setTimeLeft(left);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 500);
    return () => clearInterval(interval);
  }, [snapshot.roleSelectEndsAt, clockOffsetMs]);

  // Only active players (connected humans or bots) count against slot caps on the server
  const activePlayers = snapshot.players.filter((p) => p.connected || p.isBot);
  const writersCount = activePlayers.filter((p) => p.role === 'writer').length;
  const artistsCount = activePlayers.filter((p) => p.role === 'artist').length;
  const saboteursCount = activePlayers.filter((p) => p.role === 'saboteur').length;

  const slotLimits = snapshot.slotLimits;

  const canPickRole = (r: Role) => {
    if (me?.role === r) return true;
    if (r === 'writer') return writersCount < slotLimits.writer;
    if (r === 'artist') return artistsCount < slotLimits.artist;
    if (r === 'saboteur') return saboteursCount < slotLimits.saboteur;
    return false;
  };

  const handlePickRole = (role: Role) => {
    send({ type: 'SELECT_ROLE', role });
  };

  const handlePickClass = (saboteurClass: SaboteurClass) => {
    send({ type: 'SELECT_SABOTEUR_CLASS', saboteurClass });
  };

  return (
    <div
      className="scroll-y"
      style={{
        width: '100%',
        height: '100dvh',
        background: 'radial-gradient(circle at top, #172033 0%, #090d16 100%)',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          paddingBottom: '32px',
        }}
      >
        {/* Header with timer */}
        <div
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(18, 24, 38, 0.95)',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 700, letterSpacing: '1px' }}>
              РАСПРЕДЕЛЕНИЕ РОЛЕЙ
            </div>
            <div style={{ fontSize: '18px', fontWeight: 900, color: '#ffffff' }}>
              Выберите вашу роль в выпуске
            </div>
          </div>

          <div
            className="badge badge-amber"
            style={{
              fontSize: '14px',
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Clock size={16} />
            {timeLeft} с
          </div>
        </div>

        {/* Role Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* 1. Writer */}
          <div
            className="card"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              border: me?.role === 'writer' ? '2px solid #06b6d4' : '1px solid var(--border)',
              background: me?.role === 'writer' ? 'rgba(6, 182, 212, 0.08)' : 'var(--surface)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>✍️</span>
                <div>
                  <span style={{ fontWeight: 800, fontSize: '16px' }}>Сценарист</span>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    Придумывает сенсационный заголовок и засыпает бегущую строку фактами
                  </div>
                </div>
              </div>
              <span className="badge badge-cyan">
                {writersCount} / {slotLimits.writer}
              </span>
            </div>

            <button
              type="button"
              className={`btn ${me?.role === 'writer' ? 'btn-accent' : 'btn-secondary'}`}
              disabled={!canPickRole('writer')}
              onClick={() => handlePickRole('writer')}
              style={{ width: '100%', marginTop: '4px' }}
            >
              {me?.role === 'writer' ? (
                <>
                  <CheckCircle2 size={16} /> Роль выбрана
                </>
              ) : (
                'Выбрать Сценариста'
              )}
            </button>
          </div>

          {/* 2. Artist */}
          <div
            className="card"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              border: me?.role === 'artist' ? '2px solid #10b981' : '1px solid var(--border)',
              background: me?.role === 'artist' ? 'rgba(16, 185, 129, 0.08)' : 'var(--surface)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>🎨</span>
                <div>
                  <span style={{ fontWeight: 800, fontSize: '16px' }}>Художник</span>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    Рисует иллюстрацию к сюжету, ставит штампы и счищает пакости дворниками
                  </div>
                </div>
              </div>
              <span className="badge badge-green">
                {artistsCount} / {slotLimits.artist}
              </span>
            </div>

            <button
              type="button"
              className={`btn ${me?.role === 'artist' ? 'btn-green' : 'btn-secondary'}`}
              disabled={!canPickRole('artist')}
              onClick={() => handlePickRole('artist')}
              style={{ width: '100%', marginTop: '4px' }}
            >
              {me?.role === 'artist' ? (
                <>
                  <CheckCircle2 size={16} /> Роль выбрана
                </>
              ) : (
                'Выбрать Художника'
              )}
            </button>
          </div>

          {/* 3. Saboteur */}
          <div
            className="card"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              border: me?.role === 'saboteur' ? '2px solid #ef4444' : '1px solid var(--border)',
              background: me?.role === 'saboteur' ? 'rgba(239, 68, 68, 0.08)' : 'var(--surface)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>😈</span>
                <div>
                  <span style={{ fontWeight: 800, fontSize: '16px' }}>Зритель-саботажник</span>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    Копит энергию, применяет спец-способности и шлет реакции в эфир
                  </div>
                </div>
              </div>
              <span className="badge badge-red">
                {saboteursCount} / {slotLimits.saboteur}
              </span>
            </div>

            <button
              type="button"
              className={`btn ${me?.role === 'saboteur' ? 'btn-primary' : 'btn-secondary'}`}
              disabled={!canPickRole('saboteur')}
              onClick={() => handlePickRole('saboteur')}
              style={{ width: '100%', marginTop: '4px' }}
            >
              {me?.role === 'saboteur' ? (
                <>
                  <CheckCircle2 size={16} /> Роль выбрана
                </>
              ) : (
                'Выбрать Саботажника'
              )}
            </button>
          </div>
        </div>

        {/* Saboteur Class Selector (visible when player is saboteur) */}
        {me?.role === 'saboteur' && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Skull size={16} color="var(--red)" />
              <span style={{ fontWeight: 800, fontSize: '14px' }}>
                Специализация саботажа:
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
              {(Object.keys(SABOTEUR_CLASSES) as SaboteurClass[]).map((cKey) => {
                const sClass = SABOTEUR_CLASSES[cKey];
                const isSelected = me.saboteurClass === cKey;
                return (
                  <button
                    key={cKey}
                    type="button"
                    className="card"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      padding: '10px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      border: isSelected ? '2px solid #ef4444' : '1px solid var(--border)',
                      background: isSelected ? 'rgba(239, 68, 68, 0.15)' : 'var(--surface-2)',
                    }}
                    onClick={() => handlePickClass(cKey)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '18px' }}>{sClass.icon}</span>
                      <span style={{ fontWeight: 700, fontSize: '13px', color: '#f8fafc' }}>
                        {sClass.name}
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', lineHeight: '1.3' }}>
                      {sClass.subtitle}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Roster overview */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>
            Выбор редакции ({snapshot.players.filter((p) => p.role).length}/{snapshot.players.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {snapshot.players.map((p) => {
              const roleColor =
                p.role === 'writer'
                  ? 'badge-cyan'
                  : p.role === 'artist'
                    ? 'badge-green'
                    : p.role === 'saboteur'
                      ? 'badge-red'
                      : 'badge-gray';
              const roleTitle =
                p.role === 'writer'
                  ? '✍️ Сценарист'
                  : p.role === 'artist'
                    ? '🎨 Художник'
                    : p.role === 'saboteur'
                      ? `😈 ${p.saboteurClass ? SABOTEUR_CLASSES[p.saboteurClass].name : 'Саботажник'}`
                      : '❓ Выбирает...';

              return (
                <div
                  key={p.id}
                  className={`badge ${roleColor}`}
                  style={{ fontSize: '11px', padding: '4px 8px' }}
                >
                  <span style={{ fontWeight: 700 }}>{p.name}:</span>
                  <span>{roleTitle}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
