import { useEffect } from 'react';
import { useGameSocket, getSavedSession } from './net/useGameSocket';
import { sfx } from './audio/sfx';
import { JoinScreen } from './screens/JoinScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { RoleSelectScreen } from './screens/RoleSelectScreen';
import { BroadcastScreen } from './screens/BroadcastScreen';
import { ReplayScreen } from './screens/ReplayScreen';

export default function App() {
  const {
    connected,
    playerId,
    snapshot,
    errorMsg,
    clockOffsetMs,
    reactions,
    send,
    clearSavedRoom,
    optimisticStrokeStart,
    optimisticStrokePoints,
  } = useGameSocket();

  // Unlock Web Audio context on the first user interaction anywhere
  useEffect(() => {
    const unlockHandler = () => {
      sfx.unlock();
      window.removeEventListener('pointerdown', unlockHandler);
      window.removeEventListener('keydown', unlockHandler);
    };
    window.addEventListener('pointerdown', unlockHandler, { passive: true });
    window.addEventListener('keydown', unlockHandler, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlockHandler);
      window.removeEventListener('keydown', unlockHandler);
    };
  }, []);

  const savedSession = getSavedSession();

  return (
    <>
      {/* Toast Error Alert */}
      {errorMsg && <div className="toast-error">{errorMsg}</div>}

      {/* Offline Status Indicator */}
      {!connected && (
        <div
          style={{
            position: 'fixed',
            bottom: '10px',
            right: '10px',
            background: 'rgba(239, 68, 68, 0.9)',
            color: '#ffffff',
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 700,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span className="live-dot" />
          Подключение...
        </div>
      )}

      {/* Screens Flow */}
      {!snapshot && (
        <JoinScreen
          connected={connected}
          initialName={savedSession.name}
          onCreateRoom={(playerName) => send({ type: 'CREATE_ROOM', playerName })}
          onJoinRoom={(roomCode, playerName) =>
            send({ type: 'JOIN_ROOM', roomCode, playerName })
          }
        />
      )}

      {snapshot && snapshot.screen === 'LOBBY' && (
        <LobbyScreen
          snapshot={snapshot}
          playerId={playerId}
          send={send}
          onLeaveRoom={clearSavedRoom}
        />
      )}

      {snapshot && snapshot.screen === 'ROLE_SELECT' && (
        <RoleSelectScreen
          snapshot={snapshot}
          playerId={playerId}
          clockOffsetMs={clockOffsetMs}
          send={send}
        />
      )}

      {snapshot && snapshot.screen === 'BROADCAST' && (
        <BroadcastScreen
          snapshot={snapshot}
          playerId={playerId}
          clockOffsetMs={clockOffsetMs}
          reactions={reactions}
          send={send}
          optimisticStrokeStart={optimisticStrokeStart}
          optimisticStrokePoints={optimisticStrokePoints}
        />
      )}

      {snapshot && snapshot.screen === 'REPLAY' && (
        <ReplayScreen
          snapshot={snapshot}
          playerId={playerId}
          clockOffsetMs={clockOffsetMs}
          send={send}
        />
      )}
    </>
  );
}
