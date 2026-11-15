import { EventEmitter } from 'node:events';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { WebSocket as WsWebSocket } from 'ws';
import { RoomManager } from '../../server/roomManager.js';
import type {
  C2SMessage,
  Role,
  RoomStateSnapshot,
  S2CMessage,
  SaboteurClass,
} from '../../shared/protocol.js';

// Preserve real timers so assertion timeouts inside waitFor work reliably
// even when virtual timers (mock.timers) are enabled for state machine fast-forwarding.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

/**
 * In-memory MockWebSocket implementation backed by EventEmitter.
 * Uses microtasks to simulate asynchronous message dispatch without TCP loopback overhead
 * or sandbox permission constraints.
 */
export class MockWebSocket extends EventEmitter {
  public readyState: number = 1; // 1 = OPEN, 3 = CLOSED
  public peer: MockWebSocket | null = null;

  public send(data: string | Buffer): void {
    if (this.readyState !== 1 || !this.peer || this.peer.readyState !== 1) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    queueMicrotask(() => {
      if (this.peer && this.peer.readyState === 1) {
        this.peer.emit('message', buf);
      }
    });
  }

  public close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
    if (this.peer && this.peer.readyState !== 3) {
      this.peer.readyState = 3;
      this.peer.emit('close');
    }
  }

  public terminate(): void {
    this.close();
  }
}

/**
 * Creates an interconnected pair of in-memory MockWebSockets.
 */
export function createMockSocketPair(): [MockWebSocket, MockWebSocket] {
  const serverWs = new MockWebSocket();
  const clientWs = new MockWebSocket();
  serverWs.peer = clientWs;
  clientWs.peer = serverWs;
  return [serverWs, clientWs];
}

interface PendingListener {
  type: string;
  predicate?: (msg: any) => boolean;
  resolve: (msg: any) => void;
  timer: ReturnType<typeof realSetTimeout>;
}

/**
 * TestClient encapsulates a simulated game client connected via MockWebSocket or real WebSocket.
 * Maintains incoming message history (FIFO queue) to prevent race conditions.
 */
export class TestClient {
  public id: string = '';
  public token: string = '';
  public roomCode: string = '';
  public name: string = '';
  public lastSnapshot: RoomStateSnapshot | null = null;
  public messageHistory: S2CMessage[] = [];
  private pendingListeners: PendingListener[] = [];

  constructor(
    public readonly rawSocket: WebSocket | MockWebSocket,
    name?: string,
  ) {
    this.name = name ?? '';
    this.rawSocket.on('message', (data: any) => {
      try {
        const msg = JSON.parse(data.toString()) as S2CMessage;
        this.handleIncoming(msg);
      } catch (err) {
        console.error('TestClient JSON parse error:', err);
      }
    });
  }

  private handleIncoming(msg: S2CMessage): void {
    if (msg.type === 'WELCOME') {
      this.id = msg.playerId;
      this.token = msg.token;
      this.roomCode = msg.snapshot.roomCode;
      this.lastSnapshot = msg.snapshot;
    } else if (msg.type === 'STATE_SYNC') {
      this.lastSnapshot = msg.snapshot;
    }

    // Check pending listeners first
    for (let i = 0; i < this.pendingListeners.length; i++) {
      const listener = this.pendingListeners[i];
      if (listener.type === msg.type && (!listener.predicate || listener.predicate(msg))) {
        this.pendingListeners.splice(i, 1);
        realClearTimeout(listener.timer);
        listener.resolve(msg);
        return;
      }
    }

    // Otherwise append to FIFO buffer
    this.messageHistory.push(msg);
  }

  public send(msg: C2SMessage): void {
    this.rawSocket.send(JSON.stringify(msg));
  }

  public waitFor<T extends S2CMessage['type']>(
    type: T,
    predicate?: (msg: Extract<S2CMessage, { type: T }>) => boolean,
    timeoutMs = 4000,
  ): Promise<Extract<S2CMessage, { type: T }>> {
    // 1. Check existing unconsumed history
    const matchIdx = this.messageHistory.findIndex(
      (m) => m.type === type && (!predicate || predicate(m as any)),
    );
    if (matchIdx !== -1) {
      const [matched] = this.messageHistory.splice(matchIdx, 1);
      return Promise.resolve(matched as Extract<S2CMessage, { type: T }>);
    }

    // 2. Register pending listener with real wall-clock timeout
    return new Promise((resolve, reject) => {
      const timer = realSetTimeout(() => {
        const idx = this.pendingListeners.findIndex((l) => l.timer === timer);
        if (idx !== -1) this.pendingListeners.splice(idx, 1);
        reject(
          new Error(
            `Timeout (${timeoutMs}ms) waiting for message type "${type}" on client "${this.name || this.id}"`,
          ),
        );
      }, timeoutMs);

      this.pendingListeners.push({
        type,
        predicate: predicate as any,
        resolve: (msg: any) => {
          resolve(msg);
        },
        timer,
      });
    });
  }

  public async waitForSnapshot(
    predicate: (snapshot: RoomStateSnapshot) => boolean,
    timeoutMs = 4000,
  ): Promise<RoomStateSnapshot> {
    if (this.lastSnapshot && predicate(this.lastSnapshot)) {
      return this.lastSnapshot;
    }
    const sync = await this.waitFor(
      'STATE_SYNC',
      (m) => predicate(m.snapshot),
      timeoutMs,
    );
    return sync.snapshot;
  }

  public async createRoom(name = 'Host'): Promise<RoomStateSnapshot> {
    this.name = name;
    this.send({ type: 'CREATE_ROOM', playerName: name });
    const welcome = await this.waitFor('WELCOME');
    return welcome.snapshot;
  }

  public async joinRoom(roomCode: string, name = 'Player'): Promise<RoomStateSnapshot> {
    this.name = name;
    this.roomCode = roomCode;
    this.send({ type: 'JOIN_ROOM', roomCode, playerName: name });
    const welcome = await this.waitFor('WELCOME');
    return welcome.snapshot;
  }

  public async reconnect(roomCode: string, token: string): Promise<RoomStateSnapshot> {
    this.roomCode = roomCode;
    this.token = token;
    this.send({ type: 'RECONNECT', roomCode, token });
    const welcome = await this.waitFor('WELCOME');
    return welcome.snapshot;
  }

  public drainMessages(): S2CMessage[] {
    const list = [...this.messageHistory];
    this.messageHistory = [];
    return list;
  }

  public async close(): Promise<void> {
    // Clear pending listeners
    for (const l of this.pendingListeners) {
      realClearTimeout(l.timer);
    }
    this.pendingListeners = [];
    this.rawSocket.close();
  }
}

export interface TestHarnessOptions {
  mode?: 'in-memory' | 'network';
  port?: number;
}

export interface SetupLobbyOptions {
  playerCount?: number;
  testMode?: boolean;
  names?: string[];
}

export interface SetupGameOptions {
  writers?: number;
  artists?: number;
  saboteurs?: number;
  saboteurClasses?: SaboteurClass[];
  testMode?: boolean;
}

export interface GameRoleSetup {
  roomCode: string;
  host: TestClient;
  writers: TestClient[];
  artists: TestClient[];
  saboteurs: TestClient[];
  allClients: TestClient[];
}

/**
 * TestHarness provides an isolated test environment for Headliners multiplayer testing.
 */
export class TestHarness {
  public readonly mode: 'in-memory' | 'network';
  public readonly roomManager: RoomManager;
  public port: number = 0;
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients: TestClient[] = [];

  constructor(options: TestHarnessOptions = {}) {
    this.mode = options.mode ?? 'in-memory';
    this.port = options.port ?? 0;
    this.roomManager = new RoomManager(this.port);
  }

  public static async create(options: TestHarnessOptions = {}): Promise<TestHarness> {
    const harness = new TestHarness(options);
    if (harness.mode === 'network') {
      await harness.startNetworkServer();
    }
    return harness;
  }

  private async startNetworkServer(): Promise<void> {
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        try {
          const parsed = JSON.parse(raw.toString()) as C2SMessage;
          this.roomManager.handleMessage(ws as unknown as WsWebSocket, parsed);
        } catch {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Некорректное сообщение' }));
        }
      });
      ws.on('close', () => {
        this.roomManager.handleDisconnect(ws as unknown as WsWebSocket);
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.httpServer = server;
    this.wss = wss;
    this.port = (server.address() as any).port;
  }

  public async createClient(name = 'Player'): Promise<TestClient> {
    if (this.mode === 'in-memory') {
      const [serverWs, clientWs] = createMockSocketPair();
      serverWs.on('message', (raw) => {
        try {
          const parsed = JSON.parse(raw.toString()) as C2SMessage;
          this.roomManager.handleMessage(serverWs as unknown as WsWebSocket, parsed);
        } catch {
          serverWs.send(JSON.stringify({ type: 'ERROR', message: 'Некорректное сообщение' }));
        }
      });
      serverWs.on('close', () => {
        this.roomManager.handleDisconnect(serverWs as unknown as WsWebSocket);
      });

      const client = new TestClient(clientWs, name);
      this.clients.push(client);
      return client;
    } else {
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws`);
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', reject);
      });
      const client = new TestClient(ws, name);
      this.clients.push(client);
      return client;
    }
  }

  public async spawnClients(count: number, names?: string[]): Promise<TestClient[]> {
    const list: TestClient[] = [];
    for (let i = 0; i < count; i++) {
      const name = names?.[i] ?? `Player_${i + 1}`;
      const client = await this.createClient(name);
      list.push(client);
    }
    return list;
  }

  public async setupLobby(options: SetupLobbyOptions = {}): Promise<{
    roomCode: string;
    host: TestClient;
    players: TestClient[];
    clients: TestClient[];
  }> {
    const count = options.playerCount ?? 4;
    const names = options.names ?? Array.from({ length: count }, (_, i) => (i === 0 ? 'Host' : `Player_${i}`));

    const host = await this.createClient(names[0]);
    const hostSnapshot = await host.createRoom(names[0]);
    const roomCode = hostSnapshot.roomCode;

    if (options.testMode) {
      host.send({ type: 'TOGGLE_TEST_MODE', enabled: true });
      await host.waitForSnapshot((s) => s.testMode === true);
    }

    const players: TestClient[] = [];
    for (let i = 1; i < count; i++) {
      const player = await this.createClient(names[i]);
      await player.joinRoom(roomCode, names[i]);
      players.push(player);
    }

    const all = [host, ...players];
    // Await full player list sync on host
    await host.waitForSnapshot((s) => s.players.length === count);

    return { roomCode, host, players, clients: all };
  }

  public async setupGameWithRoles(options: SetupGameOptions = {}): Promise<GameRoleSetup> {
    const writersCount = options.writers ?? 1;
    const artistsCount = options.artists ?? 2;
    const saboteursCount = options.saboteurs ?? 1;
    const totalCount = writersCount + artistsCount + saboteursCount;
    const testMode = options.testMode ?? totalCount < 4;

    const { roomCode, host, players, clients } = await this.setupLobby({
      playerCount: totalCount,
      testMode,
    });

    // Start role select
    host.send({ type: 'START_GAME' });
    await host.waitForSnapshot((s) => s.screen === 'ROLE_SELECT');

    const writers: TestClient[] = [];
    const artists: TestClient[] = [];
    const saboteurs: TestClient[] = [];

    let cIdx = 0;
    for (let i = 0; i < writersCount; i++) {
      const client = clients[cIdx++];
      client.send({ type: 'SELECT_ROLE', role: 'writer' });
      writers.push(client);
    }
    for (let i = 0; i < artistsCount; i++) {
      const client = clients[cIdx++];
      client.send({ type: 'SELECT_ROLE', role: 'artist' });
      artists.push(client);
    }
    for (let i = 0; i < saboteursCount; i++) {
      const client = clients[cIdx++];
      const sabClass = options.saboteurClasses?.[i] ?? 'vandal';
      client.send({ type: 'SELECT_ROLE', role: 'saboteur' });
      client.send({ type: 'SELECT_SABOTEUR_CLASS', saboteurClass: sabClass });
      saboteurs.push(client);
    }

    // Drain all microtasks queued by client.send during role and class selection
    await new Promise<void>((r) => queueMicrotask(r));

    return { roomCode, host, writers, artists, saboteurs, allClients: clients };
  }

  /**
   * Cleans up all resources, sockets, intervals, and room state to ensure clean process termination.
   */
  public async cleanup(): Promise<void> {
    // 1. Close all active clients
    for (const c of this.clients) {
      try {
        await c.close();
      } catch {}
    }
    this.clients = [];

    // 2. Clear all internal room timers & intervals in RoomManager
    const roomsMap = (this.roomManager as any).rooms as Map<string, any>;
    if (roomsMap) {
      for (const room of roomsMap.values()) {
        if (room.timers) {
          for (const t of room.timers) clearTimeout(t);
          room.timers.clear();
        }
        if (room.energyInterval) {
          clearInterval(room.energyInterval);
          room.energyInterval = null;
        }
        if (room.botInterval) {
          clearInterval(room.botInterval);
          room.botInterval = null;
        }
      }
      roomsMap.clear();
    }
    const socketMap = (this.roomManager as any).socketToPlayer as Map<any, any>;
    if (socketMap) socketMap.clear();

    // 3. Close network servers if in network mode
    if (this.wss) {
      await new Promise<void>((r) => this.wss!.close(() => r()));
      this.wss = null;
    }
    if (this.httpServer) {
      await new Promise<void>((r) => this.httpServer!.close(() => r()));
      this.httpServer = null;
    }
  }
}
