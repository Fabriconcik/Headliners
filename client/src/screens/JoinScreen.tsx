import { useState, useEffect } from 'react';
import { Radio, Users, Sparkles } from 'lucide-react';
import { sfx } from '../audio/sfx';

interface Props {
  onCreateRoom: (name: string) => void;
  onJoinRoom: (code: string, name: string) => void;
  initialName?: string;
  connected: boolean;
}

export function JoinScreen({
  onCreateRoom,
  onJoinRoom,
  initialName = '',
  connected,
}: Props) {
  const [name, setName] = useState(initialName || '');
  const [code, setCode] = useState('');
  const [tab, setTab] = useState<'create' | 'join'>('join');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room') || params.get('code');
    if (roomParam) {
      setCode(roomParam.trim());
      setTab('join');
    }
  }, []);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    sfx.unlock();
    const finalName = name.trim() || 'Ведущий';
    onCreateRoom(finalName);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    sfx.unlock();
    const finalName = name.trim() || 'Игрок';
    onJoinRoom(code.trim(), finalName);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        padding: '16px',
        background: 'radial-gradient(circle at center, #1b2438 0%, #090d16 100%)',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '420px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
          border: '1px solid #2a3652',
          padding: '24px 20px',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 12px',
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid #ef4444',
              borderRadius: '999px',
              color: '#ef4444',
              fontWeight: 800,
              fontSize: '11px',
              letterSpacing: '1px',
              marginBottom: '10px',
            }}
          >
            <Radio size={14} className="live-dot" />
            В ЭФИРЕ СТУДИЯ НОВОСТЕЙ
          </div>

          <h1
            style={{
              margin: '0 0 6px 0',
              fontSize: '28px',
              fontWeight: 900,
              letterSpacing: '-0.5px',
              color: '#f8fafc',
            }}
          >
            СРОЧНО В НОМЕР!
          </h1>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '14px' }}>
            Вечеринка хаотичного прямого эфира (4–10 игроков)
          </p>
        </div>

        {/* Tab switch */}
        <div
          style={{
            display: 'flex',
            background: 'var(--surface-2)',
            padding: '4px',
            borderRadius: '10px',
            marginBottom: '20px',
            border: '1px solid var(--border)',
          }}
        >
          <button
            type="button"
            className="btn"
            style={{
              flex: 1,
              background: tab === 'join' ? '#ef4444' : 'transparent',
              color: tab === 'join' ? '#ffffff' : 'var(--muted)',
              boxShadow: tab === 'join' ? '0 2px 8px rgba(239, 68, 68, 0.4)' : 'none',
              padding: '8px',
              fontSize: '13px',
            }}
            onClick={() => setTab('join')}
          >
            <Users size={16} />
            Войти по коду
          </button>
          <button
            type="button"
            className="btn"
            style={{
              flex: 1,
              background: tab === 'create' ? '#06b6d4' : 'transparent',
              color: tab === 'create' ? '#ffffff' : 'var(--muted)',
              boxShadow: tab === 'create' ? '0 2px 8px rgba(6, 182, 212, 0.4)' : 'none',
              padding: '8px',
              fontSize: '13px',
            }}
            onClick={() => setTab('create')}
          >
            <Sparkles size={16} />
            Создать студию
          </button>
        </div>

        {/* Join form */}
        {tab === 'join' && (
          <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--muted)',
                  marginBottom: '6px',
                  textTransform: 'uppercase',
                }}
              >
                Код комнаты (4 цифры)
              </label>
              <input
                type="text"
                className="input-text"
                placeholder="Например: 1234"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                style={{ width: '100%', fontSize: '20px', fontWeight: 800, textAlign: 'center', letterSpacing: '4px' }}
                autoFocus
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--muted)',
                  marginBottom: '6px',
                  textTransform: 'uppercase',
                }}
              >
                Ваше имя в титрах
              </label>
              <input
                type="text"
                className="input-text"
                placeholder="Иван"
                maxLength={18}
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={!code.trim() || !connected}
              style={{ width: '100%', marginTop: '6px' }}
            >
              {connected ? 'Войти в студию' : 'Подключение к серверу...'}
            </button>
          </form>
        )}

        {/* Create form */}
        {tab === 'create' && (
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--muted)',
                  marginBottom: '6px',
                  textTransform: 'uppercase',
                }}
              >
                Имя ведущего (хоста)
              </label>
              <input
                type="text"
                className="input-text"
                placeholder="Шеф-редактор"
                maxLength={18}
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: '100%' }}
                autoFocus
              />
            </div>

            <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)', lineHeight: '1.4' }}>
              Вы станете хостом комнаты, сможете настроить количество ботов, запустить тест-режим и открыть эфир для друзей.
            </p>

            <button
              type="submit"
              className="btn btn-accent btn-lg"
              disabled={!connected}
              style={{ width: '100%', marginTop: '6px' }}
            >
              {connected ? 'Открыть новую студию' : 'Подключение к серверу...'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
