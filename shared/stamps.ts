export interface StampDefinition {
  id: string;
  label: string;
  icon: string;
  // Paths defined on 0..100 coordinate box
  paths: string[];
  fillRule?: 'nonzero' | 'evenodd';
}

export const STAMPS: StampDefinition[] = [
  {
    id: 'person',
    label: 'Человек',
    icon: '🏃',
    paths: [
      'M50 10 A10 10 0 1 1 49.9 10 Z',
      'M34 34 C34 26 66 26 66 34 L76 58 L67 61 L60 44 L60 66 L70 92 L59 94 L50 72 L41 94 L30 92 L40 66 L40 44 L33 61 L24 58 Z',
    ],
  },
  {
    id: 'car',
    label: 'Машина',
    icon: '🚗',
    paths: [
      'M16 54 L26 32 L68 32 L80 54 L92 56 L92 74 L82 74 A10 10 0 1 1 62 74 L38 74 A10 10 0 1 1 18 74 L8 74 L8 56 Z M32 39 L26 52 L48 52 L48 39 Z M54 39 L54 52 L73 52 L65 39 Z',
    ],
    fillRule: 'evenodd',
  },
  {
    id: 'cat',
    label: 'Зверь',
    icon: '🐱',
    paths: [
      'M22 18 L36 30 C44 27 56 27 64 30 L78 18 L80 42 C84 50 84 62 78 70 L78 88 L64 88 L64 76 C56 79 44 79 36 76 L36 88 L22 88 L22 70 C16 62 16 50 20 42 Z M38 48 A4 4 0 1 0 38 56 A4 4 0 1 0 38 48 Z M62 48 A4 4 0 1 0 62 56 A4 4 0 1 0 62 48 Z',
    ],
    fillRule: 'evenodd',
  },
  {
    id: 'fire',
    label: 'Огонь',
    icon: '🔥',
    paths: [
      'M52 8 C52 8 76 30 76 54 C76 74 64 90 48 90 C30 90 20 76 20 58 C20 44 28 32 34 26 C34 36 40 40 40 40 C38 24 52 8 52 8 Z M48 56 C40 62 38 76 48 80 C58 76 56 62 48 56 Z',
    ],
    fillRule: 'evenodd',
  },
  {
    id: 'explosion',
    label: 'Взрыв',
    icon: '💥',
    paths: [
      'M50 6 L58 28 L82 14 L70 36 L94 44 L72 56 L88 78 L64 72 L56 94 L44 74 L22 88 L30 62 L6 54 L28 42 L14 20 L38 28 Z',
    ],
  },
  {
    id: 'ufo',
    label: 'НЛО',
    icon: '🛸',
    paths: [
      'M32 40 C32 24 68 24 68 40 Z',
      'M10 52 C10 42 90 42 90 52 C90 62 10 62 10 52 Z M28 64 L18 88 L32 88 L40 64 Z M60 64 L68 88 L82 88 L72 64 Z',
    ],
  },
  {
    id: 'money',
    label: 'Деньги',
    icon: '💰',
    paths: [
      'M36 14 L64 14 L56 26 L64 30 C76 38 82 54 78 72 C75 84 65 90 50 90 C35 90 25 84 22 72 C18 54 24 38 36 30 L44 26 Z M46 42 L46 46 C40 47 38 54 43 58 C48 62 56 62 56 67 C56 71 46 72 42 69 L39 74 C42 76 45 77 46 77 L46 81 L54 81 L54 77 C60 76 63 69 58 64 C54 60 45 60 45 55 C45 51 54 51 57 53 L60 48 C58 46 55 46 54 46 L54 42 Z',
    ],
    fillRule: 'evenodd',
  },
  {
    id: 'skull',
    label: 'Череп',
    icon: '💀',
    paths: [
      'M50 10 C28 10 16 26 16 46 C16 60 24 68 32 72 L32 88 L42 88 L42 76 L46 76 L46 88 L54 88 L54 76 L58 76 L58 88 L68 88 L68 72 C76 68 84 60 84 46 C84 26 72 10 50 10 Z M34 42 A8 8 0 1 0 34 58 A8 8 0 1 0 34 42 Z M66 42 A8 8 0 1 0 66 58 A8 8 0 1 0 66 42 Z',
    ],
    fillRule: 'evenodd',
  },
];

export const STAMP_MAP: Record<string, StampDefinition> = Object.fromEntries(
  STAMPS.map((s) => [s.id, s]),
);
