import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  ABILITIES,
  ARTIST_COLORS,
  BOT_TICKER_LINES,
  BRUSH_WIDTHS,
  computeRoleSlots,
  computeTotalSegments,
  ENERGY,
  FALLBACK_HEADLINES,
  FORCED_BRUSH,
  isAbilityId,
  isRole,
  isSaboteurClass,
  LIMITS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  QUICK_REACTIONS,
  TIMINGS,
  VANDAL_STICKERS,
  type AbilityId,
  type Role,
} from '../shared/constants.js';
import { extractSingleEmoji } from '../shared/emoji.js';
import { STAMPS } from '../shared/stamps.js';
import type {
  ActiveEffectsState,
  C2SMessage,
  CanvasDrawItem,
  PlayerInfo,
  PointNorm,
  ReplayEvent,
  ReplayPayload,
  RoomStateSnapshot,
  S2CMessage,
  SabotageVisualItem,
  SegmentSummary,
  TickerMessage,
} from '../shared/protocol.js';
import {
  buildReplayPayload,
  scrambleTickerText,
  type RecordedSegment,
} from './replayAnalyzer.js';
import {
  canTakeRole,
  finalizePlayerRoles,
  randomSaboteurClass,
} from './roleAllocator.js';

interface InternalPlayer extends PlayerInfo {
  token: string;
  ws: WebSocket | null;
  lastReactionAt: number;
  preferredRole?: Role;
}

interface ActiveSegmentRuntime {
  index: number;
  totalSegments: number;
  leadWriterId: string | null;
  leadWriterName: string;
  headline: string;
  phase: 'PREP' | 'SPLASH' | 'LIVE' | 'FREEZE';
  phaseStartedAt: number;
  phaseEndsAt: number;
  liveStartedAt: number;
  splashStartedAt: number;
  events: ReplayEvent[];
  pendingTickerHacks: number;
  pointCount: number;
}

interface Room {
  code: string;
  hostId: string;
  testMode: boolean;
  screen: 'LOBBY' | 'ROLE_SELECT' | 'BROADCAST' | 'REPLAY';
  players: InternalPlayer[];
  roleSelectEndsAt: number;
  writerQueue: Array<{ id: string; name: string }>;
  currentSegmentIdx: number;
  segment: ActiveSegmentRuntime | null;
  recordedSegments: RecordedSegment[];
  drawItems: CanvasDrawItem[];
  sabotageItems: SabotageVisualItem[];
  ticker: TickerMessage[];
  effects: ActiveEffectsState;
  replay: ReplayPayload | null;
  timers: Set<ReturnType<typeof setTimeout>>;
  energyInterval: ReturnType<typeof setInterval> | null;
  botInterval: ReturnType<typeof setInterval> | null;
  lastBotActionAt: Record<string, number>;
}

const BOT_NAMES = [
  'Бот-Репортер',
  'Нейро-Вася',
  'Томатный-Бот',
  'Пиксель-Макс',
  'Кибер-Оля',
  'Глюк-Степан',
  'Режиссер-AI',
  'Папарацци-77',
  'Зритель-3000',
];

export function scoreNetworkInterface(
  name: string,
  net: { address: string; netmask?: string },
): number {
  const ip = net.address;
  let score = 50;

  // IPv4 base score by subnet type
  if (ip.startsWith('192.168.')) {
    score = 100; // Standard private home / Wi-Fi router network
  } else if (ip.startsWith('10.')) {
    score = 70; // Private Class A (often corporate, mobile hotspot, or VPN)
  } else if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) {
    score = 50; // Private Class B (common for Docker/WSL bridges)
  } else if (ip.startsWith('26.')) {
    score = 10; // Radmin VPN range
  } else if (ip.startsWith('100.')) {
    score = 10; // Tailscale / CGNAT range
  } else if (ip.startsWith('169.254.')) {
    score = -100; // APIPA link-local (no DHCP / unconfigured)
  }

  const lname = name.toLowerCase();

  // Bonus for wireless interfaces (phones connect via Wi-Fi)
  if (/(wi-?fi|беспроводн|wireless|wlan)/i.test(lname)) {
    score += 50;
  } else if (/(ethernet|локальн)/i.test(lname)) {
    score += 20;
  }

  // Heavy penalty for virtual/VPN/container network adapters
  if (
    /(vpn|virtual|vethernet|hyper-v|wsl|docker|tap|tun|teredo|wireguard|radmin|tailscale|zerotier|adguard|npcap)/i.test(
      lname,
    )
  ) {
    score -= 120;
  }

  // /32 netmask indicates a point-to-point tunnel interface where LAN discovery is impossible
  if (net.netmask === '255.255.255.255') {
    score -= 100;
  }

  return score;
}

export function getLocalLanUrls(port: number): string[] {
  const scored: { url: string; score: number }[] = [];
  const nets = os.networkInterfaces();
  const seenUrls = new Set<string>();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        const url = `http://${net.address}:${port}`;
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          scored.push({
            url,
            score: scoreNetworkInterface(name, net),
          });
        }
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const urls = scored.map((item) => item.url);
  if (urls.length === 0) {
    urls.push(`http://localhost:${port}`);
  }
  return urls;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private socketToPlayer = new Map<WebSocket, { roomCode: string; playerId: string }>();
  private lanUrls: string[];
  private clientPort: number;

  constructor(port: number) {
    // LAN addresses rarely change: cache them instead of calling
    // os.networkInterfaces() on every snapshot, but refresh when they look stale.
    this.clientPort = port;
    this.lanUrls = getLocalLanUrls(port);
  }

  /** Re-resolves LAN addresses (Wi-Fi switched on after startup, DHCP change). */
  public refreshLanUrls(): string[] {
    this.lanUrls = getLocalLanUrls(this.clientPort);
    return this.lanUrls;
  }

  private getLanUrls(): string[] {
    if (this.lanUrls.length === 0 || this.lanUrls.every((url) => url.includes('localhost'))) {
      return this.refreshLanUrls();
    }
    return this.lanUrls;
  }

  /** Stops every timer/interval and drops all rooms. Used by graceful shutdown. */
  public dispose(): void {
    for (const room of this.rooms.values()) {
      this.clearTimers(room);
    }
    this.rooms.clear();
    this.socketToPlayer.clear();
  }

  private generateRoomCode(): string {
    for (let i = 0; i < 100; i++) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      if (!this.rooms.has(code)) return code;
    }
    return String(Date.now()).slice(-4);
  }

  private send(ws: WebSocket | null, msg: S2CMessage): void {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(msg));
  }

  private broadcast(room: Room, msg: S2CMessage): void {
    const raw = JSON.stringify(msg);
    for (const p of room.players) {
      if (p.ws && p.ws.readyState === 1) {
        p.ws.send(raw);
      }
    }
  }

  private makeSnapshot(room: Room): RoomStateSnapshot {
    const now = Date.now();
    const segSummary: SegmentSummary | null = room.segment
      ? {
          index: room.segment.index,
          totalSegments: room.segment.totalSegments,
          leadWriterId: room.segment.leadWriterId,
          leadWriterName: room.segment.leadWriterName,
          headline: room.segment.headline,
          phase: room.segment.phase,
          phaseStartedAt: room.segment.phaseStartedAt,
          phaseEndsAt: room.segment.phaseEndsAt,
        }
      : null;

    return {
      roomCode: room.code,
      serverNow: now,
      screen: room.screen,
      testMode: room.testMode,
      hostId: room.hostId,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        isBot: p.isBot,
        connected: p.connected,
        role: p.role,
        saboteurClass: p.saboteurClass,
        energy: Math.round(p.energy),
        wipersCooldownUntil: p.wipersCooldownUntil,
      })),
      slotLimits: computeRoleSlots(this.activePlayers(room).length, room.testMode),
      roleSelectEndsAt: room.roleSelectEndsAt,
      segment: segSummary,
      drawItems: room.drawItems,
      sabotageItems: room.sabotageItems,
      ticker: room.ticker,
      effects: room.effects,
      replay: room.replay,
      lanUrls: this.getLanUrls(),
    };
  }

  private syncAll(room: Room): void {
    this.broadcast(room, { type: 'STATE_SYNC', snapshot: this.makeSnapshot(room) });
  }

  private clearTimers(room: Room): void {
    for (const t of room.timers) clearTimeout(t);
    room.timers.clear();
    if (room.energyInterval) {
      clearInterval(room.energyInterval);
      room.energyInterval = null;
    }
    if (room.botInterval) {
      clearInterval(room.botInterval);
      room.botInterval = null;
    }
  }

  private schedule(room: Room, fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const t = setTimeout(() => {
      room.timers.delete(t);
      fn();
    }, ms);
    room.timers.add(t);
    return t;
  }

  public handleDisconnect(ws: WebSocket): void {
    const ref = this.socketToPlayer.get(ws);
    if (!ref) return;
    this.socketToPlayer.delete(ws);

    const room = this.rooms.get(ref.roomCode);
    if (!room) return;
    const player = room.players.find((p) => p.id === ref.playerId);
    if (!player) return;

    // A close from a socket that was already replaced by a newer connection of the
    // same player must not mark the live player as disconnected.
    if (player.ws !== ws) return;

    player.ws = null;
    player.connected = false;

    this.promoteHostIfNeeded(room, player.id);
    this.syncAll(room);
    if (room.screen === 'ROLE_SELECT') {
      // The last undecided player may have just left: do not wait the full 15s.
      this.checkAllRolesReady(room);
    }
    this.scheduleRoomCleanupIfEmpty(room);
  }

  /** Moves host status to another human, never to a bot. */
  private promoteHostIfNeeded(room: Room, leavingPlayerId: string): void {
    if (room.hostId !== leavingPlayerId) return;
    const humans = room.players.filter((p) => !p.isBot);
    if (humans.length === 0) {
      room.hostId = '';
      return;
    }
    // Prefer a connected human, then the current host (if still seated), then any
    // human: a disconnected host is better than no host at all, and keeps the seat
    // when they reconnect.
    const nextHost =
      humans.find((p) => p.connected) ??
      humans.find((p) => p.id === room.hostId) ??
      humans[0];
    this.setHost(room, nextHost);
  }

  /** Deletes a room that has no connected humans for 2 minutes. */
  private scheduleRoomCleanupIfEmpty(room: Room): void {
    if (room.players.some((p) => !p.isBot && p.connected)) return;
    this.schedule(
      room,
      () => {
        if (!room.players.some((p) => !p.isBot && p.connected)) {
          this.clearTimers(room);
          this.rooms.delete(room.code);
        }
      },
      120_000,
    );
  }

  /** Players that actually take part in the current match (bots always count). */
  private activePlayers(room: Room): InternalPlayer[] {
    return room.players.filter((p) => p.isBot || p.connected);
  }

  /** Binds a fresh socket to a player, retiring the previous one if still open. */
  private attachSocket(room: Room, player: InternalPlayer, ws: WebSocket): void {
    const previous = player.ws;
    if (previous && previous !== ws) {
      this.socketToPlayer.delete(previous);
      player.ws = null;
      try {
        previous.close();
      } catch {
        // socket already closed
      }
    }
    player.ws = ws;
    player.connected = true;
    this.socketToPlayer.set(ws, { roomCode: room.code, playerId: player.id });
    // A player who missed ROLE_SELECT must not come back to a dead console.
    this.assignRoleOnReconnect(room, player);
    this.ensureHost(room);
  }

  /** Gives a returning player a usable role if they missed the role selection. */
  private assignRoleOnReconnect(room: Room, player: InternalPlayer): void {
    if (room.screen !== 'BROADCAST' || player.role !== null) return;
    const active = this.activePlayers(room);
    const limits = computeRoleSlots(active.length, room.testMode);
    const order: Role[] = ['writer', 'artist', 'saboteur'];
    const role = order.find((r) => canTakeRole(active, player.id, r, limits)) ?? 'saboteur';
    player.role = role;
    if (role === 'saboteur') {
      player.saboteurClass = player.saboteurClass ?? randomSaboteurClass();
      player.energy = Math.max(player.energy, ENERGY.START);
    } else {
      player.saboteurClass = null;
    }
  }

  /**
   * Guarantees the room always has a host that exists in the roster and, when
   * somebody is online, that the host is one of the connected humans.
   */
  private ensureHost(room: Room): void {
    const current = room.players.find((p) => p.id === room.hostId);
    if (current && current.isHost && current.connected) return;

    const humans = room.players.filter((p) => !p.isBot);
    if (humans.length === 0) return;

    const connectedHuman = humans.find((p) => p.connected);
    if (!connectedHuman) {
      // Nobody is online: keep the disconnected host's seat for a later reconnect.
      if (current && current.isHost) return;
      this.setHost(room, humans[0]);
      return;
    }
    if (current && current.isHost && current.id === connectedHuman.id) return;
    this.setHost(room, connectedHuman);
  }

  private setHost(room: Room, host: InternalPlayer): void {
    for (const p of room.players) p.isHost = p.id === host.id;
    room.hostId = host.id;
  }

  /** Releases a socket from its current room before it starts a new session. */
  private detachSocket(ws: WebSocket): void {
    if (this.socketToPlayer.has(ws)) {
      this.handleDisconnect(ws);
    }
  }

  public handleMessage(ws: WebSocket, msg: C2SMessage): void {
    // Messages arrive as untrusted JSON: validate the fields we rely on before use.
    if (msg.type === 'CREATE_ROOM') {
      if (typeof msg.playerName !== 'string') {
        this.send(ws, { type: 'ERROR', message: 'Некорректное имя игрока' });
        return;
      }
      // A socket can only represent one player: release the previous session so it
      // is not left behind as a "connected" ghost in another room.
      // createRoom() releases any previous session of this socket itself.
      this.createRoom(ws, msg.playerName, typeof msg.token === 'string' ? msg.token : undefined);
      return;
    }
    if (msg.type === 'JOIN_ROOM') {
      if (typeof msg.roomCode !== 'string' || typeof msg.playerName !== 'string') {
        this.send(ws, { type: 'ERROR', message: 'Некорректные данные подключения' });
        return;
      }
      this.joinRoom(
        ws,
        msg.roomCode,
        msg.playerName,
        typeof msg.token === 'string' ? msg.token : undefined,
      );
      return;
    }
    if (msg.type === 'RECONNECT') {
      if (typeof msg.roomCode !== 'string' || typeof msg.token !== 'string') {
        this.send(ws, { type: 'ERROR', message: 'Некорректные данные сессии' });
        return;
      }
      const previousRef = this.socketToPlayer.get(ws);
      if (previousRef) {
        const previousRoom = this.rooms.get(previousRef.roomCode);
        const previousPlayer = previousRoom?.players.find((p) => p.id === previousRef.playerId);
        if (
          previousRef.roomCode !== msg.roomCode ||
          !previousPlayer ||
          previousPlayer.token !== msg.token
        ) {
          this.detachSocket(ws);
        }
      }
      this.reconnect(ws, msg.roomCode, msg.token);
      return;
    }

    const ref = this.socketToPlayer.get(ws);
    if (!ref) {
      this.send(ws, { type: 'ERROR', message: 'Вы не подключены к комнате' });
      return;
    }
    const room = this.rooms.get(ref.roomCode);
    const player = room?.players.find((p) => p.id === ref.playerId);
    if (!room || !player) return;

    switch (msg.type) {
      case 'TOGGLE_TEST_MODE':
        if (!player.isHost || room.screen !== 'LOBBY') return;
        if (typeof msg.enabled !== 'boolean') return;
        room.testMode = msg.enabled;
        this.syncAll(room);
        break;

      case 'ADD_BOT':
        if (!player.isHost || room.screen !== 'LOBBY') return;
        if (msg.preferredRole !== undefined && !isRole(msg.preferredRole)) {
          this.send(player.ws, { type: 'ERROR', message: 'Неизвестная роль' });
          return;
        }
        this.addBot(room, msg.preferredRole);
        break;

      case 'REMOVE_BOT':
        if (!player.isHost || room.screen !== 'LOBBY') return;
        if (typeof msg.botId !== 'string') return;
        room.players = room.players.filter((p) => !(p.id === msg.botId && p.isBot));
        this.syncAll(room);
        break;

      case 'START_GAME':
        if (!player.isHost || room.screen !== 'LOBBY') return;
        this.startRoleSelect(room);
        break;

      case 'SELECT_ROLE':
        if (room.screen !== 'ROLE_SELECT') return;
        if (!isRole(msg.role)) {
          this.send(player.ws, { type: 'ERROR', message: 'Неизвестная роль' });
          return;
        }
        this.selectRole(room, player, msg.role);
        break;

      case 'SELECT_SABOTEUR_CLASS':
        if (room.screen !== 'ROLE_SELECT') return;
        if (player.role !== 'saboteur') return;
        if (!isSaboteurClass(msg.saboteurClass)) {
          this.send(player.ws, { type: 'ERROR', message: 'Неизвестный класс саботажника' });
          return;
        }
        player.saboteurClass = msg.saboteurClass;
        this.syncAll(room);
        this.checkAllRolesReady(room);
        break;

      case 'SUBMIT_HEADLINE':
        this.handleSubmitHeadline(room, player, msg.headline);
        break;

      case 'ADD_TICKER':
        this.handleAddTicker(room, player, msg.text);
        break;

      case 'STROKE_START':
        this.handleStrokeStart(room, player, msg.id, msg.color, msg.widthNorm, msg.point);
        break;

      case 'STROKE_POINTS':
        this.handleStrokePoints(room, player, msg.id, msg.points);
        break;

      case 'STROKE_END':
        break;

      case 'PLACE_STAMP':
        this.handlePlaceStamp(room, player, msg.id, msg.stampId, msg.color, msg.x, msg.y);
        break;

      case 'UNDO_LAST':
        this.handleUndoLast(room, player);
        break;

      case 'USE_WIPERS':
        this.handleUseWipers(room, player);
        break;

      case 'USE_ABILITY':
        this.handleUseAbility(room, player, msg.abilityId, msg.x, msg.y);
        break;

      case 'SEND_REACTION':
        this.handleSendReaction(room, player, msg.emoji);
        break;

      case 'LEAVE_ROOM':
        this.leaveRoom(room, player);
        break;

      case 'SKIP_REPLAY':
        if (player.isHost && room.screen === 'REPLAY') {
          this.returnToLobby(room);
        }
        break;

      case 'RETURN_TO_LOBBY':
        if (player.isHost && room.screen !== 'LOBBY') {
          this.returnToLobby(room);
        }
        break;
    }
  }

  private createRoom(ws: WebSocket, rawName: string, existingToken?: string): void {
    // A socket can only represent one player: release the previous session so it
    // is not left behind as a "connected" ghost in another room.
    this.detachSocket(ws);
    const name = truncateChars(rawName.trim(), 18) || 'Хост';
    const code = this.generateRoomCode();
    const playerId = randomUUID();
    const token = existingToken || randomUUID();

    const host: InternalPlayer = {
      id: playerId,
      name,
      isHost: true,
      isBot: false,
      connected: true,
      role: null,
      saboteurClass: null,
      energy: ENERGY.START,
      wipersCooldownUntil: 0,
      token,
      ws,
      lastReactionAt: 0,
    };

    const room: Room = {
      code,
      hostId: playerId,
      testMode: false,
      screen: 'LOBBY',
      players: [host],
      roleSelectEndsAt: 0,
      writerQueue: [],
      currentSegmentIdx: 0,
      segment: null,
      recordedSegments: [],
      drawItems: [],
      sabotageItems: [],
      ticker: [],
      effects: { flippedUntil: 0, glitchUntil: 0, forcedBrushUntil: 0, wipersAnimUntil: 0 },
      replay: null,
      timers: new Set(),
      energyInterval: null,
      botInterval: null,
      lastBotActionAt: {},
    };

    this.rooms.set(code, room);
    this.socketToPlayer.set(ws, { roomCode: code, playerId });
    this.send(ws, { type: 'WELCOME', playerId, token, snapshot: this.makeSnapshot(room) });
  }

  private joinRoom(ws: WebSocket, rawCode: string, rawName: string, existingToken?: string): void {
    const code = rawCode.trim();
    const room = this.rooms.get(code);
    if (!room) {
      this.send(ws, { type: 'ERROR', message: `Комната ${code} не найдена` });
      return;
    }

    // Reconnect by token if already in room
    if (existingToken) {
      const existing = room.players.find((p) => p.token === existingToken);
      if (existing) {
        const ref = this.socketToPlayer.get(ws);
        const sameBinding = Boolean(ref && ref.roomCode === code && ref.playerId === existing.id);
        // Moving this socket to another player/room must release the old seat, but
        // re-joining the very same binding must not demote the current host.
        if (!sameBinding) this.detachSocket(ws);
        this.attachSocket(room, existing, ws);
        this.send(ws, {
          type: 'WELCOME',
          playerId: existing.id,
          token: existing.token,
          snapshot: this.makeSnapshot(room),
        });
        this.syncAll(room);
        return;
      }
    }

    if (room.screen !== 'LOBBY') {
      this.send(ws, { type: 'ERROR', message: 'Эфир уже начался, дождитесь возврата в лобби' });
      return;
    }
    // Disconnected humans keep their seat for a possible reconnect, but must not
    // block newcomers: only players that are actually present count against the cap.
    if (this.activePlayers(room).length >= MAX_PLAYERS) {
      this.send(ws, { type: 'ERROR', message: 'Комната заполнена (максимум 10 игроков)' });
      return;
    }
    // Keep the roster bounded: a newcomer takes the seat of a disconnected player
    // instead of the room accumulating ghosts forever. Never evict the host while
    // another ghost is available, otherwise the room would lose its host seat.
    while (room.players.length >= MAX_PLAYERS) {
      let ghostIndex = room.players.findIndex(
        (p) => !p.isBot && !p.connected && p.id !== room.hostId,
      );
      if (ghostIndex === -1) {
        ghostIndex = room.players.findIndex((p) => !p.isBot && !p.connected);
      }
      if (ghostIndex === -1) {
        this.send(ws, { type: 'ERROR', message: 'Комната заполнена (максимум 10 игроков)' });
        return;
      }
      room.players.splice(ghostIndex, 1);
    }

    const name = truncateChars(rawName.trim(), 18) || `Игрок ${room.players.length + 1}`;
    const playerId = randomUUID();
    const token = existingToken || randomUUID();

    const player: InternalPlayer = {
      id: playerId,
      name,
      isHost: false,
      isBot: false,
      connected: true,
      role: null,
      saboteurClass: null,
      energy: ENERGY.START,
      wipersCooldownUntil: 0,
      token,
      ws,
      lastReactionAt: 0,
    };

    // All validation passed: release any previous session of this socket now.
    this.detachSocket(ws);
    room.players.push(player);
    this.socketToPlayer.set(ws, { roomCode: code, playerId });
    // If the host seat belonged to a ghost, the newcomer takes over so the room
    // stays playable.
    this.ensureHost(room);
    this.send(ws, { type: 'WELCOME', playerId, token, snapshot: this.makeSnapshot(room) });
    this.syncAll(room);
  }

  private reconnect(ws: WebSocket, rawCode: string, token: string): void {
    const code = rawCode.trim();
    const room = this.rooms.get(code);
    if (!room) {
      this.send(ws, { type: 'ERROR', message: 'Комната больше не существует' });
      return;
    }
    const player = room.players.find((p) => p.token === token);
    if (!player) {
      this.send(ws, { type: 'ERROR', message: 'Сессия не найдена, войдите заново' });
      return;
    }
    this.attachSocket(room, player, ws);
    this.send(ws, {
      type: 'WELCOME',
      playerId: player.id,
      token: player.token,
      snapshot: this.makeSnapshot(room),
    });
    this.syncAll(room);
  }

  private leaveRoom(room: Room, player: InternalPlayer): void {
    const ws = player.ws;
    if (ws) this.socketToPlayer.delete(ws);
    player.ws = null;
    player.connected = false;

    if (room.screen === 'LOBBY') {
      room.players = room.players.filter((p) => p.id !== player.id);
    }

    this.promoteHostIfNeeded(room, player.id);
    this.ensureHost(room);
    this.syncAll(room);

    if (!room.players.some((p) => !p.isBot)) {
      this.clearTimers(room);
      this.rooms.delete(room.code);
      return;
    }
    if (room.screen === 'ROLE_SELECT') {
      this.checkAllRolesReady(room);
    }
    this.scheduleRoomCleanupIfEmpty(room);
  }

  private addBot(room: Room, preferredRole?: Role): void {
    // Both caps matter: the total roster must stay bounded (otherwise ghost seats
    // accumulate) and the active count must not exceed the player limit.
    if (room.players.length >= MAX_PLAYERS || this.activePlayers(room).length >= MAX_PLAYERS) return;
    const usedNames = new Set(room.players.map((p) => p.name));
    const botName =
      BOT_NAMES.find((n) => !usedNames.has(n)) ?? `Бот-${room.players.length + 1}`;

    const bot: InternalPlayer = {
      id: `bot-${randomUUID().slice(0, 8)}`,
      name: botName,
      isHost: false,
      isBot: true,
      connected: true,
      role: null,
      saboteurClass: null,
      energy: ENERGY.START,
      wipersCooldownUntil: 0,
      token: randomUUID(),
      ws: null,
      lastReactionAt: 0,
      preferredRole,
    };
    room.players.push(bot);
    this.syncAll(room);
  }

  private startRoleSelect(room: Room): void {
    if (!room.testMode && this.activePlayers(room).length < MIN_PLAYERS) {
      const host = room.players.find((p) => p.isHost);
      this.send(host?.ws ?? null, {
        type: 'ERROR',
        message: `Нужно минимум ${MIN_PLAYERS} игрока (или включите Тест-режим)`,
      });
      return;
    }

    this.clearTimers(room);
    room.screen = 'ROLE_SELECT';
    room.roleSelectEndsAt = Date.now() + TIMINGS.ROLE_SELECT_MS;
    room.recordedSegments = [];
    room.replay = null;

    for (const p of room.players) {
      p.role = null;
      p.saboteurClass = null;
      p.energy = ENERGY.START;
      p.wipersCooldownUntil = 0;
    }

    this.syncAll(room);

    // Bots pick roles after a short delay
    this.schedule(room, () => this.botsPickRoles(room), 900);

    // Finalize roles at end of 15s
    this.schedule(room, () => {
      if (room.screen === 'ROLE_SELECT') {
        this.beginBroadcast(room);
      }
    }, TIMINGS.ROLE_SELECT_MS);
  }

  private botsPickRoles(room: Room): void {
    if (room.screen !== 'ROLE_SELECT') return;
    const active = this.activePlayers(room);
    const limits = computeRoleSlots(active.length, room.testMode);

    for (const p of active) {
      if (!p.isBot || p.role) continue;
      const rolesOrder: Role[] = p.preferredRole
        ? [p.preferredRole, 'artist', 'saboteur', 'writer']
        : ['artist', 'saboteur', 'writer'];

      for (const r of rolesOrder) {
        if (canTakeRole(active, p.id, r, limits)) {
          p.role = r;
          if (r === 'saboteur') p.saboteurClass = randomSaboteurClass();
          break;
        }
      }
    }
    this.syncAll(room);
  }

  private selectRole(room: Room, player: InternalPlayer, role: Role): void {
    const active = this.activePlayers(room);
    const limits = computeRoleSlots(active.length, room.testMode);
    if (!room.testMode && !canTakeRole(active, player.id, role, limits)) {
      this.send(player.ws, { type: 'ERROR', message: 'Слоты на эту роль уже заняты' });
      return;
    }
    player.role = role;
    if (role === 'saboteur' && !player.saboteurClass) {
      player.saboteurClass = 'vandal';
    }
    if (role !== 'saboteur') {
      player.saboteurClass = null;
    }
    this.syncAll(room);
    this.checkAllRolesReady(room);
  }

  private checkAllRolesReady(room: Room): void {
    if (room.screen !== 'ROLE_SELECT') return;
    // Only fast-advance once every player who is actually present has a role.
    const active = this.activePlayers(room);
    const allReady =
      active.length > 0 &&
      active.every((p) => p.role !== null && (p.role !== 'saboteur' || p.saboteurClass !== null));
    if (allReady) {
      this.schedule(room, () => {
        if (room.screen === 'ROLE_SELECT') {
          this.beginBroadcast(room);
        }
      }, 650);
    }
  }

  private beginBroadcast(room: Room): void {
    this.clearTimers(room);
    const active = this.activePlayers(room);
    finalizePlayerRoles(active, room.testMode);

    const writers = active.filter((p) => p.role === 'writer');
    const totalSegments = computeTotalSegments(writers.length);

    room.writerQueue = [];
    for (let i = 0; i < totalSegments; i++) {
      if (writers.length > 0) {
        const w = writers[i % writers.length];
        room.writerQueue.push({ id: w.id, name: w.name });
      } else {
        room.writerQueue.push({ id: '', name: 'Авто-редакция' });
      }
    }

    room.screen = 'BROADCAST';
    room.currentSegmentIdx = 0;
    room.recordedSegments = [];

    // Energy regeneration loop (every 200ms)
    room.energyInterval = setInterval(() => {
      if (room.screen !== 'BROADCAST' || room.segment?.phase !== 'LIVE') return;
      const delta = ENERGY.REGEN_PER_SEC * 0.2;
      for (const p of room.players) {
        if (p.role === 'saboteur' && p.energy < ENERGY.MAX) {
          p.energy = Math.min(ENERGY.MAX, p.energy + delta);
          if (!p.isBot && p.ws) {
            this.send(p.ws, {
              type: 'ENERGY_UPDATE',
              energy: Math.round(p.energy),
              serverNow: Date.now(),
            });
          }
        }
      }
    }, 200);

    // Bot behavior loop (every 900ms)
    room.botInterval = setInterval(() => this.runBotTick(room), 900);

    this.startSegmentPrep(room);
  }

  private startSegmentPrep(room: Room): void {
    const idx = room.currentSegmentIdx;
    const totalSegments = room.writerQueue.length;
    const lead = room.writerQueue[idx];

    room.drawItems = [];
    room.sabotageItems = [];
    room.ticker = [];
    room.effects = { flippedUntil: 0, glitchUntil: 0, forcedBrushUntil: 0, wipersAnimUntil: 0 };

    const now = Date.now();
    const leadPlayer = room.players.find((p) => p.id === lead.id);
    const hasHumanLeadWriter = Boolean(leadPlayer && !leadPlayer.isBot);
    const prepDuration = hasHumanLeadWriter ? TIMINGS.PREP_MAX_MS : 2500;

    room.segment = {
      index: idx,
      totalSegments,
      leadWriterId: lead.id || null,
      leadWriterName: lead.name,
      headline: '',
      phase: 'PREP',
      phaseStartedAt: now,
      phaseEndsAt: now + prepDuration,
      liveStartedAt: 0,
      splashStartedAt: 0,
      events: [],
      pendingTickerHacks: 0,
      pointCount: 0,
    };

    this.syncAll(room);

    this.schedule(room, () => {
      if (room.screen === 'BROADCAST' && room.segment?.index === idx && room.segment.phase === 'PREP') {
        const fallback =
          FALLBACK_HEADLINES[Math.floor(Math.random() * FALLBACK_HEADLINES.length)];
        this.transitionToSplash(room, fallback);
      }
    }, prepDuration);
  }

  private handleSubmitHeadline(room: Room, player: InternalPlayer, rawHeadline: string): void {
    if (room.screen !== 'BROADCAST' || !room.segment || room.segment.phase !== 'PREP') return;
    if (room.segment.leadWriterId !== player.id) return;
    if (typeof rawHeadline !== 'string') return;

    const cleaned = truncateChars(rawHeadline.trim(), 90);
    const headline =
      cleaned || FALLBACK_HEADLINES[Math.floor(Math.random() * FALLBACK_HEADLINES.length)];

    this.transitionToSplash(room, headline);
  }

  private transitionToSplash(room: Room, headline: string): void {
    const seg = room.segment;
    if (!seg || seg.phase !== 'PREP') return;

    const now = Date.now();
    seg.headline = headline.toUpperCase();
    seg.phase = 'SPLASH';
    seg.splashStartedAt = now;
    seg.phaseStartedAt = now;
    seg.phaseEndsAt = now + TIMINGS.SPLASH_MS;
    seg.events.push({ t: 0, type: 'PHASE', phase: 'SPLASH' });

    this.syncAll(room);

    const segIdx = seg.index;
    this.schedule(room, () => {
      if (room.screen === 'BROADCAST' && room.segment?.index === segIdx && room.segment.phase === 'SPLASH') {
        this.transitionToLive(room);
      }
    }, TIMINGS.SPLASH_MS);
  }

  private transitionToLive(room: Room): void {
    const seg = room.segment;
    if (!seg || seg.phase !== 'SPLASH') return;

    const now = Date.now();
    seg.phase = 'LIVE';
    seg.liveStartedAt = now;
    seg.phaseStartedAt = now;
    seg.phaseEndsAt = now + TIMINGS.LIVE_MS;
    seg.events.push({ t: now - seg.splashStartedAt, type: 'PHASE', phase: 'LIVE' });

    for (const p of room.players) {
      if (p.role === 'saboteur') {
        p.energy = Math.max(p.energy, ENERGY.START);
      }
      p.wipersCooldownUntil = 0;
    }

    this.syncAll(room);

    const segIdx = seg.index;
    this.schedule(room, () => {
      if (room.screen === 'BROADCAST' && room.segment?.index === segIdx && room.segment.phase === 'LIVE') {
        this.transitionToFreeze(room);
      }
    }, TIMINGS.LIVE_MS);
  }

  private transitionToFreeze(room: Room): void {
    const seg = room.segment;
    if (!seg || seg.phase !== 'LIVE') return;

    const now = Date.now();
    seg.phase = 'FREEZE';
    seg.phaseStartedAt = now;
    seg.phaseEndsAt = now + TIMINGS.FREEZE_MS;
    seg.events.push({ t: now - seg.splashStartedAt, type: 'PHASE', phase: 'FREEZE' });

    this.syncAll(room);

    const segIdx = seg.index;
    this.schedule(room, () => {
      if (room.screen === 'BROADCAST' && room.segment?.index === segIdx && room.segment.phase === 'FREEZE') {
        room.recordedSegments.push({
          segmentIndex: seg.index,
          headline: seg.headline,
          writerName: seg.leadWriterName,
          events: seg.events,
          sourceDurationMs: TIMINGS.SPLASH_MS + TIMINGS.LIVE_MS + TIMINGS.FREEZE_MS,
        });

        if (room.currentSegmentIdx + 1 < room.writerQueue.length) {
          room.currentSegmentIdx++;
          this.startSegmentPrep(room);
        } else {
          this.startReplay(room);
        }
      }
    }, TIMINGS.FREEZE_MS);
  }

  private startReplay(room: Room): void {
    this.clearTimers(room);
    room.screen = 'REPLAY';
    room.segment = null;
    room.drawItems = [];
    room.sabotageItems = [];
    room.ticker = [];
    room.effects = { flippedUntil: 0, glitchUntil: 0, forcedBrushUntil: 0, wipersAnimUntil: 0 };

    const startedAt = Date.now() + 800; // slight sync buffer for all clients
    const payload = buildReplayPayload(room.recordedSegments, startedAt);
    room.replay = payload;

    this.syncAll(room);

    this.schedule(room, () => {
      if (room.screen === 'REPLAY') {
        this.returnToLobby(room);
      }
    }, payload.totalPlaybackDurationMs + 3500);
  }

  private returnToLobby(room: Room): void {
    this.clearTimers(room);
    room.screen = 'LOBBY';
    room.segment = null;
    room.replay = null;
    room.drawItems = [];
    room.sabotageItems = [];
    room.ticker = [];
    room.effects = { flippedUntil: 0, glitchUntil: 0, forcedBrushUntil: 0, wipersAnimUntil: 0 };
    for (const p of room.players) {
      p.role = null;
      p.saboteurClass = null;
      p.energy = ENERGY.START;
      p.wipersCooldownUntil = 0;
    }
    this.syncAll(room);
  }

  private segTime(room: Room): number {
    const seg = room.segment;
    // Before SPLASH the segment has no start anchor yet: PREP must never leak a
    // `Date.now()`-sized timestamp into the replay log.
    if (!seg || seg.splashStartedAt === 0) return 0;
    return Math.max(0, Date.now() - seg.splashStartedAt);
  }

  private handleAddTicker(room: Room, player: InternalPlayer, rawText: string): void {
    if (room.screen !== 'BROADCAST' || room.segment?.phase !== 'LIVE') return;
    if (player.role !== 'writer') return;
    if (typeof rawText !== 'string') return;

    const text = truncateChars(rawText.trim(), 100);
    if (!text) return;

    const now = Date.now();
    const msg: TickerMessage = {
      id: randomUUID().slice(0, 8),
      authorName: player.name,
      text,
      createdAt: now,
    };
    room.ticker.push(msg);
    if (room.ticker.length > 15) room.ticker.shift();

    room.segment.events.push({
      t: this.segTime(room),
      type: 'TICKER_ADD',
      id: msg.id,
      authorName: msg.authorName,
      text: msg.text,
    });

    this.broadcast(room, { type: 'TICKER_ADD_BC', message: msg });

    // If a hacker already armed a ticker hack waiting for text
    if (room.segment.pendingTickerHacks > 0) {
      room.segment.pendingTickerHacks--;
      this.scheduleTickerHack(room, room.segment.index, msg.id, TIMINGS.HACKER_TICKER_DELAY_MS);
    }
  }

  private scheduleTickerHack(room: Room, segIdx: number, tickerId: string, delayMs: number): void {
    this.schedule(room, () => {
      if (room.screen !== 'BROADCAST' || room.segment?.index !== segIdx || room.segment.phase !== 'LIVE') {
        return;
      }
      const target = room.ticker.find((m) => m.id === tickerId);
      if (!target || target.hackedText) return;
      target.hackedText = scrambleTickerText(target.text);
      target.hackedAt = Date.now();
      room.segment.events.push({
        t: this.segTime(room),
        type: 'TICKER_HACK',
        id: target.id,
        hackedText: target.hackedText,
      });
      this.broadcast(room, {
        type: 'TICKER_HACK_BC',
        id: target.id,
        hackedText: target.hackedText,
      });
    }, delayMs);
  }

  private handleStrokeStart(
    room: Room,
    player: InternalPlayer,
    id: string,
    color: string,
    widthNorm: number,
    point: PointNorm,
  ): void {
    if (room.screen !== 'BROADCAST' || room.segment?.phase !== 'LIVE') return;
    if (player.role !== 'artist') return;
    if (!isValidId(id) || !isFinitePoint(point)) return;
    if (room.drawItems.length >= LIMITS.MAX_DRAW_ITEMS) return;
    if (room.segment.pointCount >= LIMITS.MAX_POINTS_PER_SEGMENT) return;

    const now = Date.now();
    const isForced = now < room.effects.forcedBrushUntil;
    const safeColor = typeof color === 'string' && color.length <= 32 ? color : '#111827';
    const safeWidth = clampNumber(widthNorm, 0.001, FORCED_BRUSH.widthNorm);
    const item = {
      kind: 'stroke' as const,
      id,
      authorId: player.id,
      color: isForced ? FORCED_BRUSH.color : safeColor,
      widthNorm: isForced ? FORCED_BRUSH.widthNorm : safeWidth,
      points: [clampPoint(point)],
    };
    room.drawItems.push(item);
    room.segment.pointCount += 1;
    // Clone item so subsequent points appended to room.drawItems in-place do not corrupt STROKE_ADD event
    room.segment.events.push({
      t: this.segTime(room),
      type: 'STROKE_ADD',
      item: { ...item, points: [...item.points] },
    });
    this.broadcast(room, { type: 'STROKE_START_BC', item });
  }

  private handleStrokePoints(
    room: Room,
    player: InternalPlayer,
    id: string,
    points: PointNorm[],
  ): void {
    if (room.screen !== 'BROADCAST' || room.segment?.phase !== 'LIVE') return;
    if (player.role !== 'artist') return;
    if (!isValidId(id) || !Array.isArray(points) || points.length === 0) return;

    const item = room.drawItems.find((d) => d.kind === 'stroke' && d.id === id);
    if (!item || item.kind !== 'stroke' || item.authorId !== player.id) return;

    const segCap = LIMITS.MAX_POINTS_PER_SEGMENT - room.segment.pointCount;
    const strokeCap = LIMITS.MAX_POINTS_PER_STROKE - item.points.length;
    const budget = Math.min(
      LIMITS.MAX_POINTS_PER_MESSAGE,
      Math.max(0, Math.min(segCap, strokeCap)),
    );
    if (budget <= 0) return;

    const clamped = points.filter(isFinitePoint).slice(0, budget).map(clampPoint);
    if (clamped.length === 0) return;

    item.points.push(...clamped);
    room.segment.pointCount += clamped.length;
    room.segment.events.push({ t: this.segTime(room), type: 'STROKE_UPDATE', id, points: clamped });
    this.broadcast(room, { type: 'STROKE_POINTS_BC', id, points: clamped });
  }

  private handlePlaceStamp(
    room: Room,
    player: InternalPlayer,
    id: string,
    stampId: string,
    color: string,
    x: number,
    y: number,
  ): void {
    if (room.screen !== 'BROADCAST' || room.segment?.phase !== 'LIVE') return;
    if (player.role !== 'artist') return;
    if (!isValidId(id) || typeof stampId !== 'string' || stampId.length > 48) return;
    if (room.drawItems.length >= LIMITS.MAX_DRAW_ITEMS) return;

    const now = Date.now();
    const isForced = now < room.effects.forcedBrushUntil;
    const safeColor = typeof color === 'string' && color.length <= 32 ? color : '#111827';
    const item = {
      kind: 'stamp' as const,
      id,
      authorId: player.id,
      stampId,
      color: isForced ? FORCED_BRUSH.color : safeColor,
      x: clamp01(x),
      y: clamp01(y),
      scaleNorm: isForced ? 0.28 : 0.17,
    };
    room.drawItems.push(item);
    room.segment.events.push({ t: this.segTime(room), type: 'STAMP_ADD', item });
    this.broadcast(room, { type: 'STAMP_ADD_BC', item });
  }

  private handleUndoLast(room: Room, player: InternalPlayer): void {
    if (room.screen !== 'BROADCAST' || room.segment?.phase !== 'LIVE') return;
    if (player.role !== 'artist') return;

    for (let i = room.drawItems.length - 1; i >= 0; i--) {
      if (room.drawItems[i].authorId === player.id) {
        const [removed] = room.drawItems.splice(i, 1);
        if (removed.kind === 'stroke') {
          room.segment.pointCount = Math.max(0, room.segment.pointCount - removed.points.length);
        }
        room.segment.events.push({ t: this.segTime(room), type: 'UNDO_ITEM', itemId: removed.id });
        this.broadcast(room, { type: 'UNDO_BC', itemId: removed.id });
        return;
      }
    }
  }

  private handleUseWipers(room: Room, player: InternalPlayer): void {
    if (room.screen !== 'BROADCAST' || room.segment?.phase !== 'LIVE') return;
    if (player.role !== 'artist') return;

    const now = Date.now();
    if (now < player.wipersCooldownUntil) return;

    player.wipersCooldownUntil = now + TIMINGS.WIPERS_COOLDOWN_MS;
    room.effects.wipersAnimUntil = now + TIMINGS.WIPERS_ANIM_MS;
    room.sabotageItems = []; // Clears ONLY sabotage layer!

    room.segment.events.push({ t: this.segTime(room), type: 'WIPERS' });
    this.broadcast(room, {
      type: 'WIPERS_BC',
      actorId: player.id,
      cooldownUntil: player.wipersCooldownUntil,
      animUntil: room.effects.wipersAnimUntil,
    });
  }

  private handleUseAbility(
    room: Room,
    player: InternalPlayer,
    abilityId: AbilityId,
    x?: number,
    y?: number,
  ): void {
    if (room.screen !== 'BROADCAST' || room.segment?.phase !== 'LIVE') return;
    if (player.role !== 'saboteur') return;
    if (!isAbilityId(abilityId)) {
      this.send(player.ws, { type: 'ERROR', message: 'Неизвестная способность' });
      return;
    }

    const cfg = ABILITIES[abilityId];
    if (!cfg || cfg.saboteurClass !== player.saboteurClass) return;
    if (player.energy < cfg.cost) return;

    player.energy -= cfg.cost;
    if (!player.isBot && player.ws) {
      this.send(player.ws, {
        type: 'ENERGY_UPDATE',
        energy: Math.round(player.energy),
        serverNow: Date.now(),
      });
    }

    const now = Date.now();
    const px = typeof x === 'number' ? clamp01(x) : 0.18 + Math.random() * 0.64;
    const py = typeof y === 'number' ? clamp01(y) : 0.2 + Math.random() * 0.6;

    if (
      abilityId === 'tomato' ||
      abilityId === 'sticker' ||
      abilityId === 'crack' ||
      abilityId === 'censor' ||
      abilityId === 'spotlight'
    ) {
      const item: SabotageVisualItem = {
        id: randomUUID().slice(0, 8),
        type: abilityId,
        x: px,
        y: py,
        scale:
          abilityId === 'censor'
            ? 0.9 + Math.random() * 0.35
            : abilityId === 'spotlight'
              ? 1.25 + Math.random() * 0.35
              : 0.85 + Math.random() * 0.4,
        rotation: abilityId === 'spotlight' ? 0 : (Math.random() - 0.5) * 0.6,
        sticker:
          abilityId === 'sticker'
            ? VANDAL_STICKERS[Math.floor(Math.random() * VANDAL_STICKERS.length)]
            : undefined,
      };
      room.sabotageItems.push(item);
      if (room.sabotageItems.length > 24) room.sabotageItems.shift();
      room.segment.events.push({ t: this.segTime(room), type: 'SABOTAGE_VISUAL', item });
      this.broadcast(room, { type: 'SABOTAGE_VISUAL_BC', item });
      return;
    }

    if (abilityId === 'glitch') {
      room.effects.glitchUntil = now + TIMINGS.GLITCH_DURATION_MS;
      room.segment.events.push({ t: this.segTime(room), type: 'SABOTAGE_FX', fx: 'glitch' });
      this.broadcast(room, { type: 'SABOTAGE_FX_BC', fx: 'glitch', until: room.effects.glitchUntil });
      return;
    }

    if (abilityId === 'flip') {
      room.effects.flippedUntil = now + TIMINGS.FLIP_DURATION_MS;
      room.segment.events.push({ t: this.segTime(room), type: 'SABOTAGE_FX', fx: 'flip' });
      this.broadcast(room, { type: 'SABOTAGE_FX_BC', fx: 'flip', until: room.effects.flippedUntil });
      return;
    }

    if (abilityId === 'forced_brush') {
      room.effects.forcedBrushUntil = now + TIMINGS.FORCED_BRUSH_DURATION_MS;
      room.segment.events.push({ t: this.segTime(room), type: 'SABOTAGE_FX', fx: 'forced_brush' });
      this.broadcast(room, {
        type: 'SABOTAGE_FX_BC',
        fx: 'forced_brush',
        until: room.effects.forcedBrushUntil,
      });
      return;
    }

    if (abilityId === 'ticker_hack') {
      const unhacked = [...room.ticker].reverse().find((m) => !m.hackedText);
      if (unhacked) {
        const remainingDelay = Math.max(
          450,
          unhacked.createdAt + TIMINGS.HACKER_TICKER_DELAY_MS - now,
        );
        this.scheduleTickerHack(room, room.segment.index, unhacked.id, remainingDelay);
      } else {
        room.segment.pendingTickerHacks++;
      }
    }
  }

  private handleSendReaction(room: Room, player: InternalPlayer, rawEmoji: string): void {
    if (room.screen !== 'BROADCAST' || room.segment?.phase !== 'LIVE') return;
    if (player.role !== 'saboteur') return;

    // Validate first: an invalid payload must not burn the anti-flood budget of
    // the player and block their next legitimate reaction.
    const emoji = extractSingleEmoji(rawEmoji);
    if (!emoji) return;

    const now = Date.now();
    if (now - player.lastReactionAt < 250) return; // anti-flood 4/sec
    player.lastReactionAt = now;

    const id = randomUUID().slice(0, 8);
    const lane = Math.random(); // 0..1 position along edge
    room.segment.events.push({ t: this.segTime(room), type: 'REACTION', id, emoji, lane });
    this.broadcast(room, { type: 'REACTION_BC', id, emoji, lane, senderId: player.id });
  }

  // --- Simulated Bot AI for solo/tablet testing ---
  private runBotTick(room: Room): void {
    if (room.screen !== 'BROADCAST' || !room.segment) return;
    const now = Date.now();

    if (room.segment.phase === 'PREP') {
      const lead = room.players.find((p) => p.id === room.segment?.leadWriterId);
      if (lead?.isBot && now - room.segment.phaseStartedAt > 1200) {
        const headline =
          FALLBACK_HEADLINES[Math.floor(Math.random() * FALLBACK_HEADLINES.length)];
        this.handleSubmitHeadline(room, lead, headline);
      }
      return;
    }

    if (room.segment.phase !== 'LIVE') return;

    for (const bot of room.players) {
      if (!bot.isBot) continue;
      const last = room.lastBotActionAt[bot.id] ?? 0;

      if (bot.role === 'writer' && now - last > 8500) {
        room.lastBotActionAt[bot.id] = now;
        const line = BOT_TICKER_LINES[Math.floor(Math.random() * BOT_TICKER_LINES.length)];
        this.handleAddTicker(room, bot, line);
      } else if (bot.role === 'artist' && now - last > 2400) {
        room.lastBotActionAt[bot.id] = now;
        if (room.sabotageItems.length >= 3 && now >= bot.wipersCooldownUntil && Math.random() < 0.6) {
          this.handleUseWipers(room, bot);
        } else if (Math.random() < 0.45) {
          const stamp = STAMPS[Math.floor(Math.random() * STAMPS.length)];
          const color = ARTIST_COLORS[Math.floor(Math.random() * ARTIST_COLORS.length)];
          this.handlePlaceStamp(
            room,
            bot,
            randomUUID().slice(0, 8),
            stamp.id,
            color,
            0.15 + Math.random() * 0.7,
            0.2 + Math.random() * 0.6,
          );
        } else {
          // Draw a quick 5-point doodle stroke
          const id = randomUUID().slice(0, 8);
          const color = ARTIST_COLORS[Math.floor(Math.random() * ARTIST_COLORS.length)];
          const cx = 0.15 + Math.random() * 0.7;
          const cy = 0.2 + Math.random() * 0.6;
          this.handleStrokeStart(room, bot, id, color, BRUSH_WIDTHS.medium, { x: cx, y: cy });
          const pts: PointNorm[] = [];
          for (let i = 1; i <= 5; i++) {
            pts.push({
              x: cx + (Math.random() - 0.5) * 0.18,
              y: cy + (Math.random() - 0.5) * 0.18,
            });
          }
          this.handleStrokePoints(room, bot, id, pts);
        }
      } else if (bot.role === 'saboteur' && now - last > 2200) {
        room.lastBotActionAt[bot.id] = now;
        // Fire reaction often
        if (Math.random() < 0.75) {
          const emoji = QUICK_REACTIONS[Math.floor(Math.random() * QUICK_REACTIONS.length)];
          this.handleSendReaction(room, bot, emoji);
        }
        // Try casting an affordable ability
        const classAbilities = Object.values(ABILITIES).filter(
          (a) => a.saboteurClass === bot.saboteurClass && a.cost <= bot.energy,
        );
        if (classAbilities.length > 0 && Math.random() < 0.55) {
          const ab = classAbilities[Math.floor(Math.random() * classAbilities.length)];
          this.handleUseAbility(room, bot, ab.id);
        }
      }
    }
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

function clampNumber(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function isFinitePoint(p: unknown): p is PointNorm {
  if (!p || typeof p !== 'object') return false;
  const { x, y } = p as PointNorm;
  return Number.isFinite(x) && Number.isFinite(y);
}

function clampPoint(p: PointNorm): PointNorm {
  return { x: clamp01(p.x), y: clamp01(p.y) };
}

/** Client-supplied identifier of a stroke/stamp: short, non-empty, well bounded. */
function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 64;
}

/** Truncates by code points so emoji/astral characters are never cut in half. */
function truncateChars(value: string, maxChars: number): string {
  const chars = Array.from(value);
  return chars.length <= maxChars ? value : chars.slice(0, maxChars).join('');
}
