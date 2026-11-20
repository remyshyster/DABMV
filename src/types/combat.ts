// src/types/combat.ts

export const BOARD_COLS = 7;
export const SIDE_ROWS = 4;
export const TOTAL_ROWS = 8;

export type UnitType = 'Knight' | 'Archer' | 'Paladin' | 'Cleric' | 'Darkmage';

export interface UnitBaseStats {
  maxHp: number;
  attack: number;
  atkSpeed: number;
  attackRange: number;
  maxMana: number;
  manaPerHit: number;
}

export interface StatBucket {
  maxHp: number;
  attack: number;
  atkSpeed: number;
  attackRange: number;
  maxMana: number;
  manaPerHit: number;
}

export interface StatModifiers {
  flat: StatBucket;
  percent: StatBucket;
}

export interface SynergyStatus {
  tag: string;
  count: number;
  thresholds: number[];
  activeTier: number;
  description: string;
}

export interface StreakState {
  type: 'win' | 'loss' | 'none';
  count: number;
}

export interface Unit {
  id: string;
  type: UnitType;
  baseStats: UnitBaseStats;
  modifiers?: StatModifiers;
  hp: number;
  maxHp: number;
  attack: number;
  atkSpeed: number;
  attackRange: number;
  mana: number;
  maxMana: number;
  manaPerHit: number;
  tags: string[];
}

export interface PositionedUnit extends Unit {
  x: number;
  y: number;
}

export type BoardState = PositionedUnit[];

export type CombatEventType = 'attack' | 'death' | 'end' | 'move';

export interface CombatEvent {
  type: CombatEventType;
  sourceId: string;
  targetId: string;
  damage: number;
  remainingHp: number;
  tick: number;
  newX?: number;
  newY?: number;
  attackerMana?: number;
  isAbility?: boolean;
  abilityName?: string;
  winnerDamage?: number;
  survivorsCount?: number;
}

/**
 * Converts an arbitrary string seed into a deterministic 32-bit unsigned integer
 * using the FNV-1a hash algorithm.
 */
export function hashStringToUint32(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Mulberry32 Seeded PRNG.
 * Returns a deterministic function generating floats in [0, 1).
 */
export function createSeededRNG(seedString: string): () => number {
  let state = hashStringToUint32(seedString);

  return function nextFloat(): number {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
