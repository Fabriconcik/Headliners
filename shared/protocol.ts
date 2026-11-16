import type {
  AbilityId,
  GameScreen,
  Role,
  RoleSlotLimits,
  SaboteurClass,
  SegmentPhase,
} from './constants.js';

export interface PlayerInfo {
  id: string;
  name: string;
  isHost: boolean;
  isBot: boolean;
  connected: boolean;
  role: Role | null;
  saboteurClass: SaboteurClass | null;
  energy: number;
  wipersCooldownUntil: number;
}

export interface PointNorm {
  x: number; // 0..1
  y: number; // 0..1
}

export interface DrawStrokeItem {
  kind: 'stroke';
  id: string;
  authorId: string;
  color: string;
  widthNorm: number; // normalized to canvas height
  points: PointNorm[];
}

export interface DrawStampItem {
  kind: 'stamp';
  id: string;
  authorId: string;
  stampId: string;
  color: string;
  x: number; // 0..1
  y: number; // 0..1
  scaleNorm: number; // fraction of canvas height, e.g. 0.16
}

export type CanvasDrawItem = DrawStrokeItem | DrawStampItem;

export interface SabotageVisualItem {
  id: string;
  type: 'tomato' | 'sticker' | 'crack' | 'censor' | 'spotlight';
  x: number; // 0..1
  y: number; // 0..1
  scale: number;
  rotation: number;
  sticker?: string;
}

export interface TickerMessage {
  id: string;
  authorName: string;
  text: string;
  hackedText?: string;
  createdAt: number;
  hackedAt?: number;
}

export interface ActiveEffectsState {
  flippedUntil: number;
  glitchUntil: number;
  forcedBrushUntil: number;
  wipersAnimUntil: number;
}

export interface SegmentSummary {
  index: number;
  totalSegments: number;
  leadWriterId: string | null;
  leadWriterName: string;
  headline: string;
  phase: SegmentPhase;
  phaseStartedAt: number;
  phaseEndsAt: number;
}

// --- Replay Event Log ---
export type ReplayEvent =
  | { t: number; type: 'SEGMENT_START'; segmentIndex: number; headline: string; writerName: string }
  | { t: number; type: 'PHASE'; phase: SegmentPhase }
  | { t: number; type: 'STROKE_ADD'; item: DrawStrokeItem }
  | { t: number; type: 'STROKE_UPDATE'; id: string; points: PointNorm[] }
  | { t: number; type: 'STAMP_ADD'; item: DrawStampItem }
  | { t: number; type: 'UNDO_ITEM'; itemId: string }
  | { t: number; type: 'WIPERS' }
  | { t: number; type: 'SABOTAGE_VISUAL'; item: SabotageVisualItem }
  | { t: number; type: 'SABOTAGE_FX'; fx: 'glitch' | 'flip' | 'forced_brush' }
  | { t: number; type: 'TICKER_ADD'; id: string; authorName: string; text: string }
  | { t: number; type: 'TICKER_HACK'; id: string; hackedText: string }
  | { t: number; type: 'REACTION'; id: string; emoji: string; lane: number };

export interface ReplaySpeedRange {
  startMs: number;
  endMs: number;
  speed: number; // 1.0 for peak moments, 2.5..3.5 otherwise
  isPeak: boolean;
}

export interface ReplayPayload {
  startedAt: number; // server timestamp when replay starts
  totalSourceDurationMs: number;
  totalPlaybackDurationMs: number;
  speedRanges: ReplaySpeedRange[];
  events: ReplayEvent[];
  cleanReplay?: boolean;
}

export interface RoomStateSnapshot {
  roomCode: string;
  serverNow: number;
  screen: GameScreen;
  testMode: boolean;
  cleanReplay: boolean;
  hostId: string;
  players: PlayerInfo[];
  slotLimits: RoleSlotLimits;
  roleSelectEndsAt: number;
  segment: SegmentSummary | null;
  drawItems: CanvasDrawItem[];
  sabotageItems: SabotageVisualItem[];
  ticker: TickerMessage[];
  effects: ActiveEffectsState;
  replay: ReplayPayload | null;
  lanUrls: string[];
}

// --- Client -> Server Messages ---
export type C2SMessage =
  | { type: 'CREATE_ROOM'; playerName: string; token?: string }
  | { type: 'JOIN_ROOM'; roomCode: string; playerName: string; token?: string }
  | { type: 'RECONNECT'; roomCode: string; token: string }
  | { type: 'TOGGLE_TEST_MODE'; enabled: boolean }
  | { type: 'TOGGLE_CLEAN_REPLAY'; enabled: boolean }
  | { type: 'ADD_BOT'; preferredRole?: Role }
  | { type: 'REMOVE_BOT'; botId: string }
  | { type: 'START_GAME' }
  | { type: 'SELECT_ROLE'; role: Role }
  | { type: 'SELECT_SABOTEUR_CLASS'; saboteurClass: SaboteurClass }
  | { type: 'SUBMIT_HEADLINE'; headline: string }
  | { type: 'ADD_TICKER'; text: string }
  | { type: 'STROKE_START'; id: string; color: string; widthNorm: number; point: PointNorm }
  | { type: 'STROKE_POINTS'; id: string; points: PointNorm[] }
  | { type: 'STROKE_END'; id: string }
  | { type: 'PLACE_STAMP'; id: string; stampId: string; color: string; x: number; y: number }
  | { type: 'UNDO_LAST' }
  | { type: 'USE_WIPERS' }
  | { type: 'USE_ABILITY'; abilityId: AbilityId; x?: number; y?: number }
  | { type: 'SEND_REACTION'; emoji: string }
  | { type: 'LEAVE_ROOM' }
  | { type: 'SKIP_REPLAY' }
  | { type: 'RETURN_TO_LOBBY' };

// --- Server -> Client Messages ---
export type S2CMessage =
  | { type: 'WELCOME'; playerId: string; token: string; snapshot: RoomStateSnapshot }
  | { type: 'STATE_SYNC'; snapshot: RoomStateSnapshot }
  | { type: 'ERROR'; message: string }
  | { type: 'ENERGY_UPDATE'; energy: number; serverNow: number }
  | { type: 'STROKE_START_BC'; item: DrawStrokeItem }
  | { type: 'STROKE_POINTS_BC'; id: string; points: PointNorm[] }
  | { type: 'STAMP_ADD_BC'; item: DrawStampItem }
  | { type: 'UNDO_BC'; itemId: string }
  | { type: 'WIPERS_BC'; actorId: string; cooldownUntil: number; animUntil: number }
  | { type: 'SABOTAGE_VISUAL_BC'; item: SabotageVisualItem }
  | { type: 'SABOTAGE_FX_BC'; fx: 'glitch' | 'flip' | 'forced_brush'; until: number }
  | { type: 'TICKER_ADD_BC'; message: TickerMessage }
  | { type: 'TICKER_HACK_BC'; id: string; hackedText: string }
  | { type: 'REACTION_BC'; id: string; emoji: string; lane: number; senderId: string };
