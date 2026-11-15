import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import {
  Users,
  Copy,
  Check,
  Bot,
  Play,
  LogOut,
  QrCode,
  Shield,
  UserPlus,
  Trash2,
} from 'lucide-react';
import type { RoomStateSnapshot, C2SMessage } from '@shared/protocol';

interface Props {
  snapshot: RoomStateSnapshot;
  playerId: string | null;
  send: (msg: C2SMessage) => void;
  onLeaveRoom: () => void;
}

export function LobbyScreen({ snapshot, playerId, send, onLeaveRoom }: Props) {
  const isHost = playerId === snapshot.hostId;
  const [copied, setCopied] = useState(false);
  const [qrUrl, setQrUrl] = useState<string>('');
  const [showQr, setShowQr] = useState(false);

  const activePlayers = snapshot.players.filter((p) => p.connected);
  const minRequired = snapshot.testMode ? 1 : 4;
  const canStart = activePlayers.length >= minRequired;

  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const [selectedLanIndex, setSelectedLanIndex] = useState(0);

  // If the host is accessing from the cloud (e.g. Render/Railway) or directly via a LAN IP,
  // window.location.origin is already the reachable address for players.
  // If the host is on localhost, pick the selected/top LAN URL so phones on Wi-Fi can connect.
  const activeLanBase =
    snapshot.lanUrls.length > 0
      ? snapshot.lanUrls[Math.min(selectedLanIndex, snapshot.lanUrls.length - 1)]
      : window.location.origin;

  const joinLink = !isLocalhost
    ? `${window.location.origin}/?room=${snapshot.roomCode}`
    : `${activeLanBase}/?room=${snapshot.roomCode}`;

  useEffect(() => {
    QRCode.toDataURL(joinLink, {
      margin: 1,
      width: 200,
      color: { dark: '#090d16', light: '#ffffff' },
    })
      .then(setQrUrl)
      .catch(() => {});
  }, [joinLink]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(joinLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          maxWidth: '540px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          paddingBottom: '32px',
        }}
      >
        {/* Top Header Card */}
        <div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            border: '1px solid #2a3652',
            background: 'rgba(18, 24, 38, 0.95)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 700, letterSpacing: '1px' }}>
                СТУДИЯ НОВОСТЕЙ
              </div>
              <div
                style={{
                  fontSize: '28px',
                  fontWeight: 900,
                  letterSpacing: '4px',
                  color: '#ffffff',
                }}
              >
                {snapshot.roomCode}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleCopyLink}
                title="Скопировать ссылку для друзей"
              >
                {copied ? <Check size={16} color="#10b981" /> : <Copy size={16} />}
                {copied ? 'Скопировано!' : 'Ссылка'}
              </button>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowQr(!showQr)}
                title="Показать QR-код"
              >
                <QrCode size={16} />
                QR
              </button>

              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={onLeaveRoom}
                title="Покинуть студию"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>

          {/* QR Code toggleable dropdown */}
          {showQr && qrUrl && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '12px',
                background: 'var(--surface-2)',
                borderRadius: '8px',
                gap: '8px',
              }}
            >
              <img
                src={qrUrl}
                alt="QR Code"
                style={{
                  width: '180px',
                  height: '180px',
                  borderRadius: '6px',
                  border: '3px solid #ffffff',
                }}
              />
              <div style={{ fontSize: '12px', color: 'var(--muted)', textAlign: 'center' }}>
                Сканируйте с телефона для быстрого входа
              </div>
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--cyan)',
                  wordBreak: 'break-all',
                  textAlign: 'center',
                  fontWeight: 600,
                  maxWidth: '100%',
                }}
              >
                {joinLink}
              </div>

              {isLocalhost && snapshot.lanUrls.length > 1 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    marginTop: '4px',
                  }}
                >
                  <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Сеть:</span>
                  {snapshot.lanUrls.map((url, idx) => {
                    const label = url.replace(/^https?:\/\//, '').replace(/:[0-9]+$/, '');
                    const isSelected = idx === selectedLanIndex;
                    return (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setSelectedLanIndex(idx)}
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          border: isSelected ? '1px solid var(--cyan)' : '1px solid var(--border)',
                          background: isSelected ? 'rgba(6, 182, 212, 0.2)' : 'var(--surface)',
                          color: isSelected ? 'var(--cyan)' : 'var(--muted)',
                          cursor: 'pointer',
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Players Roster Card */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--border)',
              paddingBottom: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={18} color="var(--cyan)" />
              <span style={{ fontWeight: 700, fontSize: '15px' }}>Команда редакции</span>
            </div>
            <div className="badge badge-cyan">
              {snapshot.players.length} / 10
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {snapshot.players.map((p) => {
              const isMe = p.id === playerId;
              return (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: isMe ? 'rgba(6, 182, 212, 0.12)' : 'var(--surface-2)',
                    border: isMe ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: p.connected ? '#10b981' : '#64748b',
                      }}
                      title={p.connected ? 'В сети' : 'Не в сети'}
                    />
                    <span style={{ fontWeight: 600, fontSize: '14px', color: p.connected ? '#f8fafc' : '#94a3b8' }}>
                      {p.name}
                    </span>
                    {isMe && <span className="badge badge-cyan" style={{ fontSize: '10px' }}>Вы</span>}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {p.isHost && (
                      <span className="badge badge-amber" style={{ fontSize: '10px' }}>
                        👑 Хост
                      </span>
                    )}
                    {p.isBot && (
                      <span className="badge badge-gray" style={{ fontSize: '10px' }}>
                        <Bot size={12} /> Бот
                      </span>
                    )}
                    {isHost && p.isBot && (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        style={{ padding: '4px 6px' }}
                        onClick={() => send({ type: 'REMOVE_BOT', botId: p.id })}
                        title="Удалить бота"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {activePlayers.length < minRequired && (
            <div style={{ fontSize: '12px', color: 'var(--amber)', textAlign: 'center', marginTop: '4px' }}>
              {snapshot.testMode
                ? 'Для старта нужен хотя бы 1 подключённый игрок'
                : `Нужно ещё ${minRequired - activePlayers.length} игроков (или включите тестовый режим)`}
            </div>
          )}
        </div>

        {/* Host Controls */}
        {isHost ? (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Shield size={18} color="var(--amber)" />
              <span style={{ fontWeight: 700, fontSize: '15px' }}>Управление эфиром</span>
            </div>

            {/* Test Mode toggle */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                background: 'var(--surface-2)',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>Тестовый режим</div>
                <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                  Старт от 1 игрока, свободный выбор любых ролей
                </div>
              </div>
              <input
                type="checkbox"
                checked={snapshot.testMode}
                onChange={(e) => send({ type: 'TOGGLE_TEST_MODE', enabled: e.target.checked })}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
            </label>

            {/* Add Bot button */}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={snapshot.players.length >= 10}
              onClick={() => send({ type: 'ADD_BOT' })}
              style={{ width: '100%' }}
            >
              <UserPlus size={16} />
              Добавить бота-игрока ({snapshot.players.length}/10)
            </button>

            {/* Start Game Button */}
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={!canStart}
              onClick={() => send({ type: 'START_GAME' })}
              style={{ width: '100%', marginTop: '4px' }}
            >
              <Play size={18} />
              В ЭФИР! (Начать выбор ролей)
            </button>
          </div>
        ) : (
          <div
            className="card"
            style={{
              textAlign: 'center',
              padding: '24px 16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <div className="live-dot" style={{ width: '12px', height: '12px' }} />
            <div style={{ fontWeight: 700, fontSize: '15px' }}>Ожидаем старта эфира</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Шеф-редактор настраивает студию и запустит распределение ролей...
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
