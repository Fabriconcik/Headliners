import { exec } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';
import { LIMITS } from '../shared/constants.js';
import type { C2SMessage } from '../shared/protocol.js';
import { getLocalLanUrls, RoomManager } from './roomManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
// Port the players actually open in the browser. In production it equals PORT;
// behind a dev proxy or reverse proxy it can differ, so it is configurable.
const CLIENT_PORT = Number(process.env.CLIENT_PORT) || PORT;
const LAN_URLS = getLocalLanUrls(CLIENT_PORT);

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  // Refresh on demand: phones may join after the laptop switched Wi-Fi network.
  res.json({ ok: true, lanUrls: roomManager.refreshLanUrls() });
});

app.get('/api/qr', async (req, res) => {
  const rawUrl = req.query.url;
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    res.status(400).json({ error: 'Missing url param' });
    return;
  }
  if (rawUrl.length > LIMITS.MAX_QR_URL_LENGTH) {
    res.status(400).json({ error: 'url param is too long' });
    return;
  }
  try {
    const dataUrl = await QRCode.toDataURL(rawUrl, {
      margin: 1,
      width: 240,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    res.json({ dataUrl });
  } catch {
    res.status(500).json({ error: 'Failed to generate QR' });
  }
});

/**
 * Production bundle lookup. Only the real build output is served: returning the
 * TypeScript sources (as the previous fallback did) can never produce a working
 * page and would leak raw sources over the LAN.
 *
 * - `npm run dev`     → Vite serves the client on :5173, this server is API/WS only.
 * - `npm start`       → `dist/client` from `npm run build` (cwd is the repo root).
 */
function resolveClientDist(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'dist/client'),
    path.resolve(__dirname, '../../dist/client'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}

const staticDir = resolveClientDist();

if (staticDir) {
  app.use(express.static(staticDir));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      next();
      return;
    }
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: LIMITS.MAX_MESSAGE_BYTES });
const roomManager = new RoomManager(CLIENT_PORT);

function sendError(ws: { readyState: number; send: (data: string) => void }, message: string): void {
  if (ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify({ type: 'ERROR', message }));
  } catch {
    // The socket went away between the check and the send: nothing to report.
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try {
      const parsed = JSON.parse(raw.toString()) as C2SMessage;
      roomManager.handleMessage(ws, parsed);
    } catch {
      sendError(ws, 'Некорректное сообщение');
    }
  });

  ws.on('close', () => {
    roomManager.handleDisconnect(ws);
  });

  // Without an 'error' listener an ECONNRESET would escalate to an unhandled
  // 'error' event and crash the whole server.
  ws.on('error', (err) => {
    console.warn('WebSocket error:', err.message);
    roomManager.handleDisconnect(ws);
  });
});

wss.on('error', (err) => {
  console.error('WebSocket server error:', err);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error('HTTP server error:', err);
  // A failed listen (EADDRINUSE/EACCES) leaves a server that will never work;
  // exiting with a clear code beats a silent zombie process behind the dev proxy.
  if (err.syscall === 'listen') {
    process.exit(1);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('================================================================');
  console.log('   LIVE NEWS CHAOS (ГОЛОВОРЕЗЫ) — СЕРВЕР ЗАПУЩЕН');
  console.log('================================================================');
  console.log(`Локальный адрес хоста : http://localhost:${PORT}`);
  if (LAN_URLS.length > 0 && LAN_URLS[0] !== `http://localhost:${PORT}`) {
    console.log(`Адрес для игроков с телефонов/планшетов (в одной Wi-Fi сети):`);
    for (const url of LAN_URLS) {
      console.log(`  -> ${url}`);
    }
  }
  if (!staticDir) {
    console.log('  [!] Сборка клиента не найдена (dist/client). Выполните: npm run build');
  }
  console.log('================================================================');

  if (process.env.OPEN_BROWSER === '1' || process.env.OPEN_BROWSER === 'true') {
    const url = `http://localhost:${PORT}`;
    const openCmd =
      process.platform === 'win32'
        ? `start "" "${url}"`
        : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
    exec(openCmd, (err) => {
      if (err) {
        console.warn('Автоматическое открытие браузера не удалось:', err.message);
      }
    });
  }
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received, shutting down...`);
  roomManager.dispose();
  for (const client of wss.clients) {
    client.close();
  }
  wss.close();
  server.close(() => process.exit(0));
  // Do not hang forever on half-open sockets.
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
