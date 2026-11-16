export type Role = 'writer' | 'artist' | 'saboteur';
export type SaboteurClass = 'vandal' | 'hacker' | 'director';
export type GameScreen = 'LOBBY' | 'ROLE_SELECT' | 'BROADCAST' | 'REPLAY';
export type SegmentPhase = 'PREP' | 'SPLASH' | 'LIVE' | 'FREEZE';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;

/** Hard limits that keep a single segment (and therefore the replay payload) bounded. */
export const LIMITS = {
  /** Max strokes + stamps stored per segment. */
  MAX_DRAW_ITEMS: 500,
  /** Max points accumulated by one stroke. */
  MAX_POINTS_PER_STROKE: 3_000,
  /** Max points across all strokes of one segment (bounds replay payload size). */
  MAX_POINTS_PER_SEGMENT: 20_000,
  /** Max points accepted in a single STROKE_POINTS message. */
  MAX_POINTS_PER_MESSAGE: 32,
  /** Max accepted WebSocket frame size (JSON messages are tiny). */
  MAX_MESSAGE_BYTES: 64 * 1024,
  /** Max length of the URL accepted by /api/qr. */
  MAX_QR_URL_LENGTH: 2_048,
} as const;

export const TIMINGS = {
  ROLE_SELECT_MS: 15_000,
  PREP_MAX_MS: 30_000,
  SPLASH_MS: 3_000,
  LIVE_MS: 45_000,
  FREEZE_MS: 3_000,
  WIPERS_COOLDOWN_MS: 7_000,
  WIPERS_ANIM_MS: 900,
  SHIELD_COOLDOWN_MS: 12_000,
  SHIELD_DURATION_MS: 4_000,
  BREAKING_NEWS_COOLDOWN_MS: 12_000,
  BREAKING_NEWS_DURATION_MS: 3_000,
  STATIC_NOISE_DURATION_MS: 3_000,
  SHAKE_DURATION_MS: 3_500,
  HACKER_TICKER_DELAY_MS: 3_000,
  FLIP_DURATION_MS: 4_000,
  GLITCH_DURATION_MS: 2_800,
  FORCED_BRUSH_DURATION_MS: 4_000,
} as const;

export const ENERGY = {
  MAX: 100,
  START: 60,
  REGEN_PER_SEC: 10,
} as const;

export const ARTIST_COLORS = [
  '#111827', // Black
  '#FFFFFF', // White
  '#EF4444', // Red
  '#F59E0B', // Amber
  '#10B981', // Emerald
  '#3B82F6', // Blue
  '#8B5CF6', // Violet
  '#EC4899', // Pink
] as const;

export type BrushSizeKey = 'thin' | 'medium' | 'thick';

// Normalized to canvas height (e.g., 0.008 * height)
export const BRUSH_WIDTHS: Record<BrushSizeKey, number> = {
  thin: 0.0065,
  medium: 0.015,
  thick: 0.032,
};

export const FORCED_BRUSH = {
  color: '#FF10F0', // Acid neon pink
  widthNorm: 0.075, // Huge brush
} as const;

export const QUICK_REACTIONS = ['😂', '😱', '🤦', '👏'] as const;

export type AbilityId =
  | 'tomato'
  | 'sticker'
  | 'crack'
  | 'ticker_hack'
  | 'glitch'
  | 'flip'
  | 'censor'
  | 'forced_brush'
  | 'spotlight'
  | 'ink_splat'
  | 'static_noise'
  | 'camera_shake';

export type SaboteurAbilityId = AbilityId;

export interface AbilityConfig {
  id: AbilityId;
  saboteurClass: SaboteurClass;
  name: string;
  shortDesc: string;
  cost: number;
  positional: boolean;
  icon: string;
}

export const ABILITIES: Record<AbilityId, AbilityConfig> = {
  tomato: {
    id: 'tomato',
    saboteurClass: 'vandal',
    name: 'Помидор / клякса',
    shortDesc: 'Шлепок поверх кадра (можно тапнуть по ТВ)',
    cost: 25,
    positional: true,
    icon: '🍅',
  },
  sticker: {
    id: 'sticker',
    saboteurClass: 'vandal',
    name: 'Нелепый стикер',
    shortDesc: 'Дурацкая наклейка на рисунок',
    cost: 30,
    positional: true,
    icon: '🤡',
  },
  crack: {
    id: 'crack',
    saboteurClass: 'vandal',
    name: 'Трещина на объективе',
    shortDesc: 'Разбивает стекло камеры',
    cost: 40,
    positional: true,
    icon: '🕸️',
  },
  ink_splat: {
    id: 'ink_splat',
    saboteurClass: 'vandal',
    name: 'Масляная клякса',
    shortDesc: 'Черная жирная клякса на холст',
    cost: 30,
    positional: true,
    icon: '🖤',
  },
  ticker_hack: {
    id: 'ticker_hack',
    saboteurClass: 'hacker',
    name: 'Взлом строки',
    shortDesc: 'Перемешивает буквы бегущей строки через 3 сек',
    cost: 35,
    positional: false,
    icon: '👾',
  },
  glitch: {
    id: 'glitch',
    saboteurClass: 'hacker',
    name: 'Глитч и тряска',
    shortDesc: 'Помехи сигнала и тряска экрана',
    cost: 50,
    positional: false,
    icon: '📺',
  },
  flip: {
    id: 'flip',
    saboteurClass: 'hacker',
    name: 'Переворот на 4с',
    shortDesc: 'Переворачивает холст вверх ногами',
    cost: 65,
    positional: false,
    icon: '🙃',
  },
  static_noise: {
    id: 'static_noise',
    saboteurClass: 'hacker',
    name: 'Шум эфира / Помехи',
    shortDesc: 'Белый телевизионный шум на 3 сек',
    cost: 40,
    positional: false,
    icon: '📡',
  },
  censor: {
    id: 'censor',
    saboteurClass: 'director',
    name: 'ЦЕНЗУРА',
    shortDesc: 'Черная плашка поверх части холста',
    cost: 40,
    positional: true,
    icon: '⬛',
  },
  forced_brush: {
    id: 'forced_brush',
    saboteurClass: 'director',
    name: 'Розовая кисть 4с',
    shortDesc: 'Гигантская кислотно-розовая кисть всем!',
    cost: 55,
    positional: false,
    icon: '🖌️',
  },
  spotlight: {
    id: 'spotlight',
    saboteurClass: 'director',
    name: 'Прожектор',
    shortDesc: 'Ослепляющий софит поверх рисунка',
    cost: 45,
    positional: true,
    icon: '🔦',
  },
  camera_shake: {
    id: 'camera_shake',
    saboteurClass: 'director',
    name: 'Землетрясение / Тряска',
    shortDesc: 'Мощное землетрясение и дрожание камеры 3.5с',
    cost: 45,
    positional: false,
    icon: '📳',
  },
};

export const SABOTEUR_ABILITIES = ABILITIES;

export const SABOTEUR_CLASSES: Record<
  SaboteurClass,
  {
    id: SaboteurClass;
    name: string;
    subtitle: string;
    icon: string;
    abilities: AbilityId[];
    specialAbility: AbilityId;
  }
> = {
  vandal: {
    id: 'vandal',
    name: 'Вандал',
    subtitle: 'Помидоры, стикеры, трещины и чернила',
    icon: '🍅',
    abilities: ['tomato', 'sticker', 'crack'],
    specialAbility: 'ink_splat',
  },
  hacker: {
    id: 'hacker',
    name: 'Хакер',
    subtitle: 'Взлом строки, глитч, переворот и помехи',
    icon: '👾',
    abilities: ['ticker_hack', 'glitch', 'flip'],
    specialAbility: 'static_noise',
  },
  director: {
    id: 'director',
    name: 'Режиссер-вредитель',
    subtitle: 'Плашки ЦЕНЗУРА, софиты, розовая кисть и землетрясение',
    icon: '🎬',
    abilities: ['censor', 'forced_brush', 'spotlight'],
    specialAbility: 'camera_shake',
  },
};

export const VANDAL_STICKERS = ['🤡', '💩', '🍌', '🐷', '👁️', '🛸', '🧦', '🧀'] as const;

export const FALLBACK_HEADLINES = [
  'КОТ ЗАХВАТИЛ МЕСТНУЮ МЭРИЮ И ТРЕБУЕТ СМЕТАНЫ',
  'НЛО ПРИПАРКОВАЛОСЬ НА ГАЗОНЕ И ПОЛУЧИЛО ШТРАФ',
  'УЧЕНЫЕ СЛУЧАЙНО ИЗОБРЕЛИ ПОНЕДЕЛЬНИК ВТОРОЙ РАЗ',
  'ПОГОДА СЛЕТЕЛА С КАТУШЕК: ДОЖДЬ ИЗ ПЕЛЬМЕНЕЙ',
  'ГОЛУБИ ОСНОВАЛИ СВОЮ КРИПТОВАЛЮТУ НА ПЛОЩАДИ',
  'ПРОПАВШИЙ ХОЛОДИЛЬНИК НАЙДЕН В ЦЕНТРЕ ГОРОДА',
  'В МЕТРО ЗАМЕЧЕН ДИНОЗАВР БЕЗ ПРОЕЗДНОГО',
] as const;

export const BOT_TICKER_LINES = [
  'Очевидцы утверждают, что это было громко!',
  'Полиция пытается договориться о перемирии.',
  'Прямое включение: никто ничего не понимает!',
  'Эксперты в студии разводят руками.',
  'Ущерб оценивается в три ведра попкорна.',
  'Ситуация стремительно выходит из-под контроля!',
  'Местные жители снимают всё на тапок.',
] as const;

export interface RoleSlotLimits {
  writer: number;
  artist: number;
  saboteur: number;
}

export function computeRoleSlots(playerCount: number, testMode: boolean): RoleSlotLimits {
  if (testMode && playerCount < MIN_PLAYERS) {
    // Allow lone tester or 2-3 testers to freely try any role
    return { writer: 1, artist: 2, saboteur: 1 };
  }
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, playerCount));
  const table: Record<number, RoleSlotLimits> = {
    4: { writer: 1, artist: 2, saboteur: 1 },
    5: { writer: 1, artist: 3, saboteur: 1 },
    6: { writer: 2, artist: 3, saboteur: 1 },
    7: { writer: 2, artist: 3, saboteur: 2 },
    8: { writer: 2, artist: 4, saboteur: 2 },
    9: { writer: 2, artist: 4, saboteur: 3 },
    10: { writer: 3, artist: 4, saboteur: 3 },
  };
  return table[n] ?? { writer: 2, artist: 4, saboteur: Math.max(1, n - 6) };
}

/** Number of scenes in one broadcast: one per writer, but never fewer than 3. */
export function computeTotalSegments(writerCount: number): number {
  const n = Number.isFinite(writerCount) ? Math.floor(writerCount) : 0;
  return Math.max(3, n);
}

// --- Runtime guards for client-supplied values ---------------------------------
// Messages arrive as untrusted JSON; never trust the declared TypeScript types.

const ROLE_VALUES: readonly Role[] = ['writer', 'artist', 'saboteur'];
const SABOTEUR_CLASS_VALUES: readonly SaboteurClass[] = ['vandal', 'hacker', 'director'];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLE_VALUES as readonly string[]).includes(value);
}

export function isSaboteurClass(value: unknown): value is SaboteurClass {
  return (
    typeof value === 'string' && (SABOTEUR_CLASS_VALUES as readonly string[]).includes(value)
  );
}

export function isAbilityId(value: unknown): value is AbilityId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ABILITIES, value);
}
