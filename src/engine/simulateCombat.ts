// src/engine/simulateCombat.ts

import {
  BOARD_COLS,
  TOTAL_ROWS,
  BoardState,
  CombatEvent,
  PositionedUnit,
  UnitType,
  createSeededRNG,
} from '../types/combat';
import { projectToCombatBoard, resolveBoardWithSynergies } from './stats';

export interface InternalUnit extends PositionedUnit {
  team: 'A' | 'B';
  actionGauge: number;
}

const ABILITY_CONFIG: Record<UnitType, { name: string; multiplier: number }> = {
  Knight: { name: 'Shield Slam', multiplier: 1.5 },
  Archer: { name: 'Power Shot', multiplier: 2.0 },
  Paladin: { name: 'Holy Smite', multiplier: 1.5 },
  Cleric: { name: 'Divine Light', multiplier: 2.0 },
  Darkmage: { name: 'Shadow Bolt', multiplier: 2.0 },
};

/**
 * Squared Euclidean distance avoids floating-point square root drift across architectures.
 */
export function getDistanceSquared(u1: InternalUnit, u2: InternalUnit): number {
  const dx = u1.x - u2.x;
  const dy = u1.y - u2.y;
  return dx * dx + dy * dy;
}

export function getGridDistance(u1: InternalUnit, u2: InternalUnit): number {
  return Math.max(Math.abs(u1.x - u2.x), Math.abs(u1.y - u2.y));
}

const DIRECTIONS: ReadonlyArray<[number, number]> = [
  [0, 1],
  [1, 1],
  [-1, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [1, -1],
  [-1, -1],
];

interface BFSNode {
  x: number;
  y: number;
  firstStepX: number;
  firstStepY: number;
}

/**
 * Deterministic 8-way BFS pathfinding on the 7x8 combat arena.
 * Pass 1 finds the shortest path to any tile within attackRange of the primary target,
 * while simultaneously tracking:
 * - firstAnyEnemyStep: first reachable tile within attackRange of any living enemy
 * - bestCloserStep: reachable tile strictly closer (squared Euclidean) to target than attacker's current position
 */
export function findNextStepBFS(
  attacker: InternalUnit,
  target: InternalUnit,
  enemies: InternalUnit[],
  roster: InternalUnit[]
): { x: number; y: number } | null {
  const occupied = new Set<string>();
  for (const u of roster) {
    if (u.hp > 0 && u.id !== attacker.id) {
      occupied.add(`${u.x},${u.y}`);
    }
  }

  const visited = new Set<string>([`${attacker.x},${attacker.y}`]);
  const queue: BFSNode[] = [];

  for (const [dx, dy] of DIRECTIONS) {
    const nx = attacker.x + dx;
    const ny = attacker.y + dy;
    if (nx < 0 || nx >= BOARD_COLS || ny < 0 || ny >= TOTAL_ROWS) continue;
    const key = `${nx},${ny}`;
    if (occupied.has(key) || visited.has(key)) continue;
    visited.add(key);
    queue.push({ x: nx, y: ny, firstStepX: nx, firstStepY: ny });
  }

  const currentDistSq =
    (attacker.x - target.x) * (attacker.x - target.x) +
    (attacker.y - target.y) * (attacker.y - target.y);

  let firstAnyEnemyStep: { x: number; y: number } | null = null;
  let bestCloserDistSq = currentDistSq;
  let bestCloserStep: { x: number; y: number } | null = null;

  let head = 0;
  while (head < queue.length) {
    const node = queue[head++];

    // Pass 1: Reach Primary Target within attackRange
    if (
      Math.max(Math.abs(node.x - target.x), Math.abs(node.y - target.y)) <=
      attacker.attackRange
    ) {
      return { x: node.firstStepX, y: node.firstStepY };
    }

    // Fallback 1: First reachable tile within attackRange of any living enemy
    if (firstAnyEnemyStep === null) {
      for (const enemy of enemies) {
        if (
          enemy.hp > 0 &&
          Math.max(Math.abs(node.x - enemy.x), Math.abs(node.y - enemy.y)) <=
            attacker.attackRange
        ) {
          firstAnyEnemyStep = { x: node.firstStepX, y: node.firstStepY };
          break;
        }
      }
    }

    // Fallback 2: Reachable tile strictly closer to primary target than attacker's current position
    const distSq =
      (node.x - target.x) * (node.x - target.x) +
      (node.y - target.y) * (node.y - target.y);
    if (distSq < bestCloserDistSq) {
      bestCloserDistSq = distSq;
      bestCloserStep = { x: node.firstStepX, y: node.firstStepY };
    }

    for (const [dx, dy] of DIRECTIONS) {
      const nx = node.x + dx;
      const ny = node.y + dy;
      if (nx < 0 || nx >= BOARD_COLS || ny < 0 || ny >= TOTAL_ROWS) continue;
      const key = `${nx},${ny}`;
      if (occupied.has(key) || visited.has(key)) continue;
      visited.add(key);
      queue.push({
        x: nx,
        y: ny,
        firstStepX: node.firstStepX,
        firstStepY: node.firstStepY,
      });
    }
  }

  return firstAnyEnemyStep ?? bestCloserStep ?? null;
}

export function simulateCombat(
  boardA: BoardState,
  boardB: BoardState,
  seed: string
): CombatEvent[] {
  const rng = createSeededRNG(seed);
  const events: CombatEvent[] = [];

  // Phase 0: Resolve layered stats + synergies and project boards onto shared 7x8 arena
  // Board A occupies y: [0..3] (bottom), Board B is mirrored to y: [4..7] (top)
  const { units: resolvedA } = resolveBoardWithSynergies(boardA);
  const { units: resolvedB } = resolveBoardWithSynergies(boardB);

  const projectedA = projectToCombatBoard(resolvedA, 'A');
  const projectedB = projectToCombatBoard(resolvedB, 'B');

  const unitsA: InternalUnit[] = projectedA.map((u) => ({
    ...u,
    team: 'A',
    actionGauge: 0,
  }));

  const unitsB: InternalUnit[] = projectedB.map((u) => ({
    ...u,
    team: 'B',
    actionGauge: 0,
  }));

  // Canonical sort by ID to guarantee identical memory order across platforms
  const roster: InternalUnit[] = [...unitsA, ...unitsB].sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  // Tick-0 Empty-Board Check: Resolve open-fort or empty boards immediately at Tick 0
  const aliveA = roster.filter((u) => u.team === 'A' && u.hp > 0);
  const aliveB = roster.filter((u) => u.team === 'B' && u.hp > 0);

  if (aliveA.length === 0 || aliveB.length === 0) {
    let sourceId: 'TEAM_A' | 'TEAM_B' | 'DRAW';
    let survivorsCount: number;
    let winnerDamage: number;

    if (aliveA.length === 0 && aliveB.length === 0) {
      sourceId = 'DRAW';
      survivorsCount = 0;
      winnerDamage = 1;
    } else if (aliveA.length > 0) {
      sourceId = 'TEAM_A';
      survivorsCount = aliveA.length;
      winnerDamage = 1 + aliveA.length;
    } else {
      sourceId = 'TEAM_B';
      survivorsCount = aliveB.length;
      winnerDamage = 1 + aliveB.length;
    }

    events.push({
      type: 'end',
      sourceId,
      targetId: 'NONE',
      damage: 0,
      remainingHp: 0,
      tick: 0,
      winnerDamage,
      survivorsCount,
    });
    return events;
  }

  let tickCount = 0;
  const MAX_TICKS = 2000; // Circuit breaker against infinite loops

  while (tickCount < MAX_TICKS) {
    const livingA = roster.filter((u) => u.team === 'A' && u.hp > 0);
    const livingB = roster.filter((u) => u.team === 'B' && u.hp > 0);

    // Termination Check
    if (livingA.length === 0 || livingB.length === 0) {
      let winnerTeam: 'TEAM_A' | 'TEAM_B' | 'DRAW';
      let survivorsCount = 0;
      let winnerDamage = 1;

      if (livingA.length > 0) {
        winnerTeam = 'TEAM_A';
        survivorsCount = livingA.length;
        winnerDamage = 1 + survivorsCount;
      } else if (livingB.length > 0) {
        winnerTeam = 'TEAM_B';
        survivorsCount = livingB.length;
        winnerDamage = 1 + survivorsCount;
      } else {
        winnerTeam = 'DRAW';
        survivorsCount = 0;
        winnerDamage = 1;
      }

      events.push({
        type: 'end',
        sourceId: winnerTeam,
        targetId: 'NONE',
        damage: 0,
        remainingHp: 0,
        tick: tickCount,
        winnerDamage,
        survivorsCount,
      });
      break;
    }

    tickCount++;

    // Phase 1 (Gauge Fill): For all living units, add (atkSpeed * 0.1) to actionGauge
    // Precision rounded to 4 decimals to eliminate IEEE 754 precision drift across JavaScript engines
    for (const unit of roster) {
      if (unit.hp > 0) {
        unit.actionGauge = Math.round((unit.actionGauge + unit.atkSpeed * 0.1) * 10000) / 10000;
      }
    }

    // Phase 2 (Intent Phase): Filter units where actionGauge >= 1.0. These units are "ready".
    // Deterministically sort ready units by canonical ID to guarantee identical RNG sequence
    const readyUnits = roster
      .filter((u) => u.hp > 0 && u.actionGauge >= 1.0)
      .sort((a, b) => a.id.localeCompare(b.id));

    interface PendingAttack {
      attacker: InternalUnit;
      target: InternalUnit;
    }
    const pendingAttacks: PendingAttack[] = [];

    for (const attacker of readyUnits) {
      const livingEnemies = roster.filter(
        (u) => u.team !== attacker.team && u.hp > 0
      );

      if (livingEnemies.length === 0) continue;

      // Find closest living enemy (or equidistant candidates)
      let minDistanceSq = Infinity;
      let closestCandidates: InternalUnit[] = [];

      for (const enemy of livingEnemies) {
        const distSq = getDistanceSquared(attacker, enemy);
        if (distSq < minDistanceSq) {
          minDistanceSq = distSq;
          closestCandidates = [enemy];
        } else if (distSq === minDistanceSq) {
          closestCandidates.push(enemy);
        }
      }

      // Break ties deterministically using seeded RNG
      const targetIndex = Math.floor(rng() * closestCandidates.length);
      const target = closestCandidates[targetIndex];

      pendingAttacks.push({ attacker, target });
    }

    // Phase 3 (Resolution Phase): Iterate through pending attacks and apply damage or movement
    for (const { attacker, target } of pendingAttacks) {
      if (attacker.hp <= 0) continue;

      if (getGridDistance(attacker, target) <= attacker.attackRange) {
        // IF IN RANGE: Execute attack / ability logic
        const isAbility = attacker.mana >= attacker.maxMana;
        let damage = attacker.attack;
        let abilityName: string | undefined = undefined;

        if (isAbility) {
          const config = ABILITY_CONFIG[attacker.type] || { name: 'Special Attack', multiplier: 1.5 };
          damage = attacker.attack * config.multiplier;
          abilityName = config.name;
          attacker.mana = 0;
        } else {
          attacker.mana = Math.min(attacker.maxMana, attacker.mana + attacker.manaPerHit);
        }

        const wasAlive = target.hp > 0;
        target.hp = Math.max(0, target.hp - damage);

        events.push({
          type: 'attack',
          sourceId: attacker.id,
          targetId: target.id,
          damage,
          remainingHp: target.hp,
          tick: tickCount,
          attackerMana: attacker.mana,
          isAbility,
          abilityName,
        });

        if (wasAlive && target.hp === 0) {
          events.push({
            type: 'death',
            sourceId: attacker.id,
            targetId: target.id,
            damage: 0,
            remainingHp: 0,
            tick: tickCount,
          });
        }
      } else {
        // IF OUT OF RANGE: Execute deterministic 8-way BFS movement
        const enemies = roster.filter((u) => u.team !== attacker.team && u.hp > 0);
        const nextStep = findNextStepBFS(attacker, target, enemies, roster);

        if (nextStep) {
          attacker.x = nextStep.x;
          attacker.y = nextStep.y;

          events.push({
            type: 'move',
            sourceId: attacker.id,
            targetId: 'NONE',
            damage: 0,
            remainingHp: attacker.hp,
            tick: tickCount,
            newX: attacker.x,
            newY: attacker.y,
          });
        }
      }

      // Always reduce attacker.actionGauge by 1.0 at the end of their action
      attacker.actionGauge = Math.round((attacker.actionGauge - 1.0) * 10000) / 10000;
    }
  }

  return events;
}
