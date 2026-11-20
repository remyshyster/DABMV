// src/engine/stats.ts

import {
  BOARD_COLS,
  SIDE_ROWS,
  TOTAL_ROWS,
  BoardState,
  PositionedUnit,
  StatBucket,
  StatModifiers,
  StreakState,
  SynergyStatus,
  Unit,
  UnitBaseStats,
  UnitType,
} from '../types/combat';

export { BOARD_COLS, SIDE_ROWS, TOTAL_ROWS };

export const MAX_LEVEL = 9;

export const XP_TO_NEXT_LEVEL: Record<number, number | null> = {
  1: 2,
  2: 4,
  3: 8,
  4: 16,
  5: 32,
  6: 48,
  7: 64,
  8: 80,
  9: null,
};

export const ALL_UNIT_TYPES: UnitType[] = [
  'Knight',
  'Archer',
  'Paladin',
  'Cleric',
  'Darkmage',
];

export interface UnitTemplate {
  tags: string[];
  baseStats: UnitBaseStats;
}

export const UNIT_TEMPLATES: Record<UnitType, UnitTemplate> = {
  Knight: {
    tags: ['Human', 'Tank'],
    baseStats: {
      maxHp: 1000,
      attack: 25,
      atkSpeed: 0.4,
      attackRange: 1,
      maxMana: 50,
      manaPerHit: 10,
    },
  },
  Archer: {
    tags: ['Elf', 'Ranger'],
    baseStats: {
      maxHp: 600,
      attack: 40,
      atkSpeed: 0.7,
      attackRange: 3,
      maxMana: 30,
      manaPerHit: 10,
    },
  },
  Paladin: {
    tags: ['Human', 'Bruiser'],
    baseStats: {
      maxHp: 1200,
      attack: 20,
      atkSpeed: 0.5,
      attackRange: 1,
      maxMana: 40,
      manaPerHit: 10,
    },
  },
  Cleric: {
    tags: ['Elf', 'Mage'],
    baseStats: {
      maxHp: 500,
      attack: 15,
      atkSpeed: 0.6,
      attackRange: 3,
      maxMana: 50,
      manaPerHit: 10,
    },
  },
  Darkmage: {
    tags: ['Human', 'Mage'],
    baseStats: {
      maxHp: 600,
      attack: 30,
      atkSpeed: 0.6,
      attackRange: 3,
      maxMana: 60,
      manaPerHit: 10,
    },
  },
};

function createZeroStatBucket(): StatBucket {
  return {
    maxHp: 0,
    attack: 0,
    atkSpeed: 0,
    attackRange: 0,
    maxMana: 0,
    manaPerHit: 0,
  };
}

export function createEmptyModifiers(): StatModifiers {
  return {
    flat: createZeroStatBucket(),
    percent: createZeroStatBucket(),
  };
}

export function createUnit(
  type: UnitType,
  id: string,
  x: number,
  y: number
): PositionedUnit {
  const template = UNIT_TEMPLATES[type];
  const baseStats: UnitBaseStats = { ...template.baseStats };

  return {
    id,
    type,
    x,
    y,
    baseStats,
    modifiers: createEmptyModifiers(),
    hp: baseStats.maxHp,
    maxHp: baseStats.maxHp,
    attack: baseStats.attack,
    atkSpeed: baseStats.atkSpeed,
    attackRange: baseStats.attackRange,
    mana: 0,
    maxMana: baseStats.maxMana,
    manaPerHit: baseStats.manaPerHit,
    tags: [...template.tags],
  };
}

export function generateRandomShop(
  slotCount = 3,
  rng: () => number = Math.random
): UnitType[] {
  const shop: UnitType[] = [];
  for (let i = 0; i < slotCount; i++) {
    const idx = Math.floor(rng() * ALL_UNIT_TYPES.length);
    shop.push(ALL_UNIT_TYPES[idx]);
  }
  return shop;
}

export function calculateSynergies(board: BoardState): SynergyStatus[] {
  const seenTypes = new Set<UnitType>();
  const tagCounts: Record<string, number> = {};

  for (const unit of board) {
    if (!seenTypes.has(unit.type)) {
      seenTypes.add(unit.type);
      const tags = unit.tags || UNIT_TEMPLATES[unit.type].tags;
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
  }

  const humanCount = tagCounts['Human'] || 0;
  const elfCount = tagCounts['Elf'] || 0;
  const mageCount = tagCounts['Mage'] || 0;

  return [
    {
      tag: 'Human',
      count: humanCount,
      thresholds: [2, 3],
      activeTier: humanCount >= 3 ? 2 : humanCount >= 2 ? 1 : 0,
      description: '2: +100 Max HP | 3: +200 Max HP to Humans',
    },
    {
      tag: 'Elf',
      count: elfCount,
      thresholds: [2],
      activeTier: elfCount >= 2 ? 1 : 0,
      description: '2: +25% Atk Speed to Elves',
    },
    {
      tag: 'Mage',
      count: mageCount,
      thresholds: [2],
      activeTier: mageCount >= 2 ? 1 : 0,
      description: '2: +10 Mana/Hit to Mages',
    },
  ];
}

export function resolveStat(
  base: number,
  flat: number,
  percent: number,
  isFloat = false
): number {
  const result = (base + flat) * (1 + percent);
  if (isFloat) {
    return Math.round(result * 1000) / 1000;
  }
  return Math.round(result);
}

export function resolveBoardWithSynergies(board: BoardState): {
  units: BoardState;
  synergies: SynergyStatus[];
} {
  const synergies = calculateSynergies(board);

  const humanCount = synergies.find((s) => s.tag === 'Human')?.count ?? 0;
  const elfCount = synergies.find((s) => s.tag === 'Elf')?.count ?? 0;
  const mageCount = synergies.find((s) => s.tag === 'Mage')?.count ?? 0;

  const units: BoardState = board.map((unit) => {
    const baseStats: UnitBaseStats = { ...unit.baseStats };
    const tags = [...(unit.tags || UNIT_TEMPLATES[unit.type].tags)];
    const modifiers = createEmptyModifiers();

    if (tags.includes('Human')) {
      if (humanCount >= 3) {
        modifiers.flat.maxHp += 200;
      } else if (humanCount >= 2) {
        modifiers.flat.maxHp += 100;
      }
    }

    if (tags.includes('Elf') && elfCount >= 2) {
      modifiers.percent.atkSpeed += 0.25;
    }

    if (tags.includes('Mage') && mageCount >= 2) {
      modifiers.flat.manaPerHit += 10;
    }

    const maxHp = resolveStat(baseStats.maxHp, modifiers.flat.maxHp, modifiers.percent.maxHp, false);
    const attack = resolveStat(baseStats.attack, modifiers.flat.attack, modifiers.percent.attack, false);
    const atkSpeed = resolveStat(baseStats.atkSpeed, modifiers.flat.atkSpeed, modifiers.percent.atkSpeed, true);
    const attackRange = resolveStat(baseStats.attackRange, modifiers.flat.attackRange, modifiers.percent.attackRange, false);
    const maxMana = resolveStat(baseStats.maxMana, modifiers.flat.maxMana, modifiers.percent.maxMana, false);
    const manaPerHit = resolveStat(baseStats.manaPerHit, modifiers.flat.manaPerHit, modifiers.percent.manaPerHit, false);

    return {
      ...unit,
      baseStats,
      modifiers,
      tags,
      hp: maxHp,
      maxHp,
      attack,
      atkSpeed,
      attackRange,
      maxMana,
      manaPerHit,
    };
  });

  return { units, synergies };
}

export function projectToCombatBoard(board: BoardState, team: 'A' | 'B'): BoardState {
  return board.map((unit) => ({
    ...unit,
    baseStats: { ...unit.baseStats },
    modifiers: unit.modifiers
      ? {
          flat: { ...unit.modifiers.flat },
          percent: { ...unit.modifiers.percent },
        }
      : undefined,
    tags: [...unit.tags],
    x: unit.x,
    y: team === 'A' ? unit.y : TOTAL_ROWS - 1 - unit.y,
  }));
}

export function applyXpGain(
  currentLevel: number,
  currentXp: number,
  amount: number
): { level: number; xp: number } {
  if (currentLevel >= MAX_LEVEL) {
    return { level: MAX_LEVEL, xp: 0 };
  }

  let level = currentLevel;
  let xp = currentXp + amount;

  while (level < MAX_LEVEL) {
    const needed = XP_TO_NEXT_LEVEL[level];
    if (needed !== null && needed !== undefined && xp >= needed) {
      xp -= needed;
      level += 1;
    } else {
      break;
    }
  }

  if (level >= MAX_LEVEL) {
    xp = 0;
  }

  return { level, xp };
}

export function updateStreak(
  current: StreakState,
  result: 'win' | 'loss' | 'draw'
): StreakState {
  if (result === 'draw') {
    return { type: 'none', count: 0 };
  }
  if (current.type === result) {
    return { type: result, count: current.count + 1 };
  }
  return { type: result, count: 1 };
}

export function getStreakBonusGold(streak: StreakState): number {
  if (streak.type === 'win') {
    if (streak.count >= 5) return 3;
    if (streak.count >= 4) return 2;
    if (streak.count >= 2) return 1;
    return 0;
  }
  if (streak.type === 'loss') {
    if (streak.count >= 6) return 3;
    if (streak.count >= 5) return 2;
    if (streak.count >= 3) return 1;
    return 0;
  }
  return 0;
}

export const SYNERGY_COLORS: Record<string, string> = {
  Human: '#38bdf8', // Sky Blue
  Elf: '#4ade80',   // Emerald
  Mage: '#c084fc',  // Violet
};

export function getActiveSynergyColorsForUnit(
  unitTags: string[],
  synergies: SynergyStatus[]
): string[] {
  const activeTags = new Set(
    synergies.filter((s) => s.activeTier > 0).map((s) => s.tag)
  );
  return unitTags
    .filter((tag) => activeTags.has(tag) && Boolean(SYNERGY_COLORS[tag]))
    .map((tag) => SYNERGY_COLORS[tag]);
}

export function buildInwardSynergyRingShadow(
  colors: string[],
  ringWidthPx = 2
): string | undefined {
  if (colors.length === 0) return undefined;
  // First shadow paints on top (outermost edge); each subsequent shadow steps inward strictly inside the box.
  return colors
    .map((color, idx) => `inset 0 0 0 ${(idx + 1) * ringWidthPx}px ${color}`)
    .join(', ');
}

export function getBotLevelForRound(round: number): number {
  if (round <= 1) return 1;
  if (round <= 3) return 2;
  if (round <= 5) return 3;
  return Math.min(MAX_LEVEL, round - 2);
}

const BOT_ROSTER_BLUEPRINT: ReadonlyArray<{ type: UnitType; x: number; y: number }> = [
  { type: 'Knight', x: 3, y: 3 },   // Lv 1: Frontline
  { type: 'Archer', x: 3, y: 0 },   // Lv 2: Backline
  { type: 'Paladin', x: 2, y: 3 },  // Lv 3: Activates 2 Human
  { type: 'Cleric', x: 2, y: 0 },   // Lv 4: Activates 2 Elf
  { type: 'Darkmage', x: 4, y: 0 }, // Lv 5: Activates 3 Human + 2 Mage
  { type: 'Knight', x: 4, y: 3 },   // Lv 6
  { type: 'Archer', x: 5, y: 0 },   // Lv 7
  { type: 'Paladin', x: 1, y: 3 },  // Lv 8
  { type: 'Darkmage', x: 1, y: 0 }, // Lv 9
];

export function generateBotBoard(botLevel: number): BoardState {
  const clampedLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(botLevel)));
  return BOT_ROSTER_BLUEPRINT.slice(0, clampedLevel).map((slot, idx) =>
    createUnit(slot.type, `bot-${idx + 1}`, slot.x, slot.y)
  );
}

export const MAX_INTEREST_GOLD = 5;

export function getInterestGold(gold: number): number {
  if (gold < 10) return 0;
  return Math.min(MAX_INTEREST_GOLD, Math.floor(gold / 10));
}

export const UNIT_BASE_COST = 3;

export function getUnitSellValue(_unit?: Pick<Unit, 'type'>): number {
  // 1-star units currently refund their full purchase cost.
  // Centralized here so future cost tiers and star upgrades update in one place.
  return UNIT_BASE_COST;
}




