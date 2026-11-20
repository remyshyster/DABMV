import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeededRNG, BoardState, StreakState } from '../types/combat';
import { simulateCombat } from './simulateCombat';
import {
  ALL_UNIT_TYPES,
  MAX_LEVEL,
  UNIT_BASE_COST,
  XP_TO_NEXT_LEVEL,
  applyXpGain,
  createUnit,
  generateBotBoard,
  getBotLevelForRound,
  getInterestGold,
  getStreakBonusGold,
  getUnitSellValue,
  projectToCombatBoard,
  resolveBoardWithSynergies,
  updateStreak,
} from './stats';

test('Mulberry32 PRNG is strictly deterministic for identical seeds', () => {
  const rng1 = createSeededRNG('match-seed-12345');
  const rng2 = createSeededRNG('match-seed-12345');

  const seq1 = [rng1(), rng1(), rng1(), rng1(), rng1()];
  const seq2 = [rng2(), rng2(), rng2(), rng2(), rng2()];

  assert.deepEqual(seq1, seq2, 'Sequences with identical seed must match exactly');

  const rngDifferent = createSeededRNG('different-seed');
  const seqDiff = [rngDifferent(), rngDifferent(), rngDifferent()];
  assert.notDeepEqual(seq1.slice(0, 3), seqDiff, 'Different seeds must produce different sequences');
});

test('simulateCombat executes deterministically on identical inputs', () => {
  const boardA: BoardState = [
    createUnit('Knight', 'knight-a1', 2, 3),
    createUnit('Archer', 'archer-a2', 4, 0),
  ];

  const boardB: BoardState = [
    createUnit('Knight', 'knight-b1', 2, 3),
    createUnit('Archer', 'archer-b2', 4, 0),
  ];

  const seed = 'test-seed-xyz-987';

  // Run simulation 1
  const events1 = simulateCombat(boardA, boardB, seed);
  // Run simulation 2 with freshly cloned boards
  const events2 = simulateCombat(
    JSON.parse(JSON.stringify(boardA)),
    JSON.parse(JSON.stringify(boardB)),
    seed
  );

  assert.equal(events1.length > 0, true, 'Simulation should generate events');
  assert.deepEqual(events1, events2, 'Two runs with identical seeds and boards must be 100% identical');

  const lastEvent1 = events1[events1.length - 1];
  assert.equal(lastEvent1.type, 'end', 'Last event must be end');
  assert.ok(['TEAM_A', 'TEAM_B', 'DRAW'].includes(lastEvent1.sourceId), 'Winner must be TEAM_A, TEAM_B, or DRAW');
  assert.ok(lastEvent1.tick > 0, 'Last event must include a valid tick');
  assert.ok(lastEvent1.winnerDamage !== undefined, 'Last event must have winnerDamage');
  assert.ok(lastEvent1.survivorsCount !== undefined, 'Last event must have survivorsCount');
});

test('Action Gauge system supports simultaneous attacks in the same tick', () => {
  // Two identical Archers on Board A at y=2 (Chebyshev distance to Team B's frontline y=3->4 is 2 <= attackRange 3)
  // Duplicate Archer copies count as 1 unique Elf, so atkSpeed remains 0.7 (ready on tick 15: 15 * 0.07 = 1.05)
  const boardA: BoardState = [
    createUnit('Archer', 'archer-a1', 2, 2),
    createUnit('Archer', 'archer-a2', 4, 2),
  ];
  const boardB: BoardState = [
    createUnit('Knight', 'knight-b1', 3, 3),
  ];

  const events = simulateCombat(boardA, boardB, 'simultaneous-test-seed');

  const firstTickAttacks = events.filter((e) => e.type === 'attack' && e.tick === 15);
  assert.equal(firstTickAttacks.length, 2, 'Both archers must attack simultaneously at tick 15');
  assert.equal(firstTickAttacks[0].sourceId, 'archer-a1');
  assert.equal(firstTickAttacks[1].sourceId, 'archer-a2');
});

test('simulateCombat correctly resolves combat when one team is overwhelmingly stronger', () => {
  const strongKnight = createUnit('Knight', 'knight-strong', 3, 3);
  strongKnight.baseStats.attack = 500;
  strongKnight.attack = 500;
  strongKnight.baseStats.atkSpeed = 1.0;
  strongKnight.atkSpeed = 1.0;

  const weakArcher = createUnit('Archer', 'archer-weak', 3, 3);
  weakArcher.baseStats.maxHp = 20;
  weakArcher.hp = 20;
  weakArcher.maxHp = 20;
  weakArcher.baseStats.attack = 5;
  weakArcher.attack = 5;

  const events = simulateCombat([strongKnight], [weakArcher], 'overwhelming-seed');
  const lastEvent = events[events.length - 1];
  assert.equal(lastEvent.type, 'end');
  assert.equal(lastEvent.sourceId, 'TEAM_A', 'TEAM_A should win overwhelmingly');
  assert.equal(lastEvent.survivorsCount, 1, 'TEAM_A should have 1 survivor');
  assert.equal(lastEvent.winnerDamage, 2, 'Winner damage is 1 + survivorsCount = 2');

  // Verify death event was recorded
  const deathEvents = events.filter((e) => e.type === 'death');
  assert.equal(deathEvents.length, 1);
  assert.equal(deathEvents[0].targetId, 'archer-weak');
});

test('Abilities and Mana system charges mana and casts ability when full', () => {
  // Team A Archer at (3, 1), Team B Knight at (3, 3) -> projected to (3, 4)
  // Chebyshev distance = |1 - 4| = 3 <= attackRange 3
  const boardA: BoardState = [
    createUnit('Archer', 'archer-tester', 3, 1),
  ];
  const boardB: BoardState = [
    createUnit('Knight', 'knight-sponge', 3, 3),
  ];

  const events = simulateCombat(boardA, boardB, 'mana-ability-test-seed');
  const archerAttacks = events.filter((e) => e.type === 'attack' && e.sourceId === 'archer-tester');

  // Attack 1: mana was 0 -> increases to 10, not ability, damage 40
  assert.equal(archerAttacks[0].isAbility, false);
  assert.equal(archerAttacks[0].damage, 40);
  assert.equal(archerAttacks[0].attackerMana, 10);

  // Attack 2: mana was 10 -> increases to 20, not ability, damage 40
  assert.equal(archerAttacks[1].isAbility, false);
  assert.equal(archerAttacks[1].damage, 40);
  assert.equal(archerAttacks[1].attackerMana, 20);

  // Attack 3: mana was 20 -> increases to 30 (maxMana), not ability, damage 40
  assert.equal(archerAttacks[2].isAbility, false);
  assert.equal(archerAttacks[2].damage, 40);
  assert.equal(archerAttacks[2].attackerMana, 30);

  // Attack 4: mana was 30 (>= maxMana 30) -> triggers Power Shot!
  // damage: attack * 2.0 = 80, resets mana to 0
  assert.equal(archerAttacks[3].isAbility, true);
  assert.equal(archerAttacks[3].abilityName, 'Power Shot');
  assert.equal(archerAttacks[3].damage, 80);
  assert.equal(archerAttacks[3].attackerMana, 0);
});

test('Layered stat pipeline applies Human Max HP buff without mutating baseStats and projects Team B frontline y=3 to y=4', () => {
  const knight = createUnit('Knight', 'k1', 2, 3);
  const paladin = createUnit('Paladin', 'p1', 4, 3);
  const archer = createUnit('Archer', 'a1', 3, 0);

  const { units: resolvedUnits, synergies } = resolveBoardWithSynergies([knight, paladin, archer]);

  const humanSynergy = synergies.find((s) => s.tag === 'Human');
  assert.equal(humanSynergy?.count, 2, 'Two unique Human units should register count 2');
  assert.equal(humanSynergy?.activeTier, 1, 'Human count 2 should activate tier 1');

  const resolvedKnight = resolvedUnits.find((u) => u.id === 'k1')!;
  const resolvedPaladin = resolvedUnits.find((u) => u.id === 'p1')!;
  const resolvedArcher = resolvedUnits.find((u) => u.id === 'a1')!;

  // 2 unique Humans add +100 flat maxHp to Human units without mutating baseStats.maxHp
  assert.equal(resolvedKnight.maxHp, 1100);
  assert.equal(resolvedKnight.hp, 1100);
  assert.equal(resolvedKnight.baseStats.maxHp, 1000, 'Knight baseStats.maxHp must remain unmutated');
  assert.equal(knight.baseStats.maxHp, 1000, 'Original unit baseStats.maxHp must remain unmutated');

  assert.equal(resolvedPaladin.maxHp, 1300);
  assert.equal(resolvedPaladin.hp, 1300);
  assert.equal(resolvedPaladin.baseStats.maxHp, 1200, 'Paladin baseStats.maxHp must remain unmutated');

  // Non-Human unit should not receive the Human Max HP buff
  assert.equal(resolvedArcher.maxHp, 600);
  assert.equal(resolvedArcher.hp, 600);

  // Verify coordinate projection: Team B frontline y=3 projects to y=4, backline y=0 projects to y=7
  const projectedB = projectToCombatBoard(resolvedUnits, 'B');
  const projectedKnightB = projectedB.find((u) => u.id === 'k1')!;
  const projectedArcherB = projectedB.find((u) => u.id === 'a1')!;

  assert.equal(projectedKnightB.x, 2, 'Team B x coordinate should remain unchanged');
  assert.equal(projectedKnightB.y, 4, 'Team B frontline y=3 must project to y=4');
  assert.equal(projectedArcherB.y, 7, 'Team B backline y=0 must project to y=7');

  // Verify Team A projection preserves bottom-left Cartesian coordinates
  const projectedA = projectToCombatBoard(resolvedUnits, 'A');
  const projectedKnightA = projectedA.find((u) => u.id === 'k1')!;
  const projectedArcherA = projectedA.find((u) => u.id === 'a1')!;
  assert.equal(projectedKnightA.y, 3, 'Team A frontline y=3 stays at y=3');
  assert.equal(projectedArcherA.y, 0, 'Team A backline y=0 stays at y=0');
});

test('BFS Pathing Around Blocker routes flanking unit around occupied tile', () => {
  const boardA: BoardState = [
    createUnit('Knight', 'knight-a1', 3, 2),
    createUnit('Paladin', 'paladin-blocker', 3, 3),
  ];
  const boardB: BoardState = [
    createUnit('Knight', 'knight-b1', 3, 2), // projected to (3, 5)
  ];

  const events = simulateCombat(boardA, boardB, 'bfs-blocker-seed');

  const knightMoves = events.filter(
    (e) => e.type === 'move' && e.sourceId === 'knight-a1'
  );
  assert.ok(knightMoves.length > 0, 'Team A Knight must emit move events');

  const flankingMove = knightMoves.find((e) => e.newX !== 3);
  assert.ok(
    flankingMove !== undefined,
    'Team A Knight must route to an unobstructed flanking tile (x !== 3) around the blocker rather than remaining stuck'
  );

  const knightAttacks = events.filter(
    (e) => e.type === 'attack' && e.sourceId === 'knight-a1'
  );
  assert.ok(
    knightAttacks.length > 0,
    'Team A Knight must reach attack range and engage Team B Knight after flanking'
  );
});

test('Tick-0 Empty Board Resolution handles empty single side and mutual empty boards cleanly', () => {
  const eventsEmptyA = simulateCombat(
    [],
    [createUnit('Knight', 'b1', 3, 3)],
    'empty-a'
  );

  assert.equal(eventsEmptyA.length, 1, 'Empty Team A should emit a single end event');
  assert.equal(eventsEmptyA[0].type, 'end');
  assert.equal(eventsEmptyA[0].tick, 0);
  assert.equal(eventsEmptyA[0].sourceId, 'TEAM_B');
  assert.equal(eventsEmptyA[0].survivorsCount, 1);
  assert.equal(eventsEmptyA[0].winnerDamage, 2);

  const eventsEmptyBoth = simulateCombat([], [], 'empty-both');

  assert.equal(eventsEmptyBoth.length, 1, 'Empty both teams should emit a single end event');
  assert.equal(eventsEmptyBoth[0].type, 'end');
  assert.equal(eventsEmptyBoth[0].tick, 0);
  assert.equal(eventsEmptyBoth[0].sourceId, 'DRAW');
  assert.equal(eventsEmptyBoth[0].survivorsCount, 0);
  assert.equal(eventsEmptyBoth[0].winnerDamage, 1);
});

test('applyXpGain follows Level 1-9 XP curve, handles multi-level rollover, and caps at Lv 9', () => {
  const expectedCurve = [
    { level: 1, needed: 2 },
    { level: 2, needed: 4 },
    { level: 3, needed: 8 },
    { level: 4, needed: 16 },
    { level: 5, needed: 32 },
    { level: 6, needed: 48 },
    { level: 7, needed: 64 },
    { level: 8, needed: 80 },
  ];

  // Verify exact progression across every level in the curve
  let state = { level: 1, xp: 0 };
  for (const { level, needed } of expectedCurve) {
    assert.equal(XP_TO_NEXT_LEVEL[level], needed);

    const short = applyXpGain(state.level, state.xp, needed - 1);
    assert.equal(short.level, level, `Level ${level} should not advance at ${needed - 1} XP`);
    assert.equal(short.xp, needed - 1);

    state = applyXpGain(short.level, short.xp, 1);
    assert.equal(state.level, level + 1, `Level ${level} should advance to ${level + 1} at ${needed} XP`);
    assert.equal(state.xp, 0);
  }

  assert.equal(state.level, MAX_LEVEL);
  assert.equal(XP_TO_NEXT_LEVEL[MAX_LEVEL], null);

  // Verify multi-level rollover (Lv 1 with 0 XP + 6 XP -> Lv 3 with 0 XP)
  const rolloverExact = applyXpGain(1, 0, 6);
  assert.deepEqual(rolloverExact, { level: 3, xp: 0 });

  // Verify multi-level rollover with remainder (Lv 1 with 0 XP + 15 XP -> Lv 4 with 1 XP: 2 + 4 + 8 = 14)
  const rolloverRemainder = applyXpGain(1, 0, 15);
  assert.deepEqual(rolloverRemainder, { level: 4, xp: 1 });

  // Verify capping at Lv 9 (overflow XP clamped to 0)
  const cappedFromLower = applyXpGain(8, 70, 50);
  assert.deepEqual(cappedFromLower, { level: 9, xp: 0 });

  const cappedAtMax = applyXpGain(9, 0, 10);
  assert.deepEqual(cappedAtMax, { level: 9, xp: 0 });
});

test('updateStreak and getStreakBonusGold handle Win, staggered Loss, and Draw resets', () => {
  let streak: StreakState = { type: 'none', count: 0 };
  assert.equal(getStreakBonusGold(streak), 0);

  // Win streak: 1W=0g, 2W=+1g, 3W=+1g, 4W=+2g, 5W=+3g, 6W=+3g
  const expectedWinGold = [0, 1, 1, 2, 3, 3];
  for (let i = 0; i < expectedWinGold.length; i++) {
    streak = updateStreak(streak, 'win');
    assert.equal(streak.type, 'win');
    assert.equal(streak.count, i + 1);
    assert.equal(getStreakBonusGold(streak), expectedWinGold[i], `Win streak ${i + 1} gold mismatch`);
  }

  // Draw resets streak count to 0 and bonus to 0g
  streak = updateStreak(streak, 'draw');
  assert.deepEqual(streak, { type: 'none', count: 0 });
  assert.equal(getStreakBonusGold(streak), 0);

  // Loss streak (staggered): 1L=0g, 2L=0g, 3L=+1g, 4L=+1g, 5L=+2g, 6L=+3g, 7L=+3g
  const expectedLossGold = [0, 0, 1, 1, 2, 3, 3];
  for (let i = 0; i < expectedLossGold.length; i++) {
    streak = updateStreak(streak, 'loss');
    assert.equal(streak.type, 'loss');
    assert.equal(streak.count, i + 1);
    assert.equal(getStreakBonusGold(streak), expectedLossGold[i], `Loss streak ${i + 1} gold mismatch`);
  }

  // Switching from loss to win resets count to 1
  streak = updateStreak(streak, 'win');
  assert.deepEqual(streak, { type: 'win', count: 1 });
  assert.equal(getStreakBonusGold(streak), 0);
});

test('getBotLevelForRound scales bot level across rounds and generateBotBoard outputs valid unique tiles', () => {
  assert.equal(getBotLevelForRound(1), 1);
  assert.equal(getBotLevelForRound(2), 2);
  assert.equal(getBotLevelForRound(4), 3);
  assert.equal(getBotLevelForRound(6), 4);
  assert.equal(getBotLevelForRound(12), 9);

  const botBoardLv1 = generateBotBoard(1);
  assert.equal(botBoardLv1.length, 1, 'Level 1 bot board must contain 1 unit');
  assert.ok(
    botBoardLv1[0].x >= 0 && botBoardLv1[0].x < 7 && botBoardLv1[0].y >= 0 && botBoardLv1[0].y < 4,
    'Level 1 bot unit must be placed at valid local coordinates (0 <= x < 7, 0 <= y < 4)'
  );

  const botBoardLv9 = generateBotBoard(9);
  assert.equal(botBoardLv9.length, 9, 'Level 9 bot board must contain 9 units');
  const uniqueTiles = new Set<string>();
  for (const unit of botBoardLv9) {
    assert.ok(
      unit.x >= 0 && unit.x < 7 && unit.y >= 0 && unit.y < 4,
      `Bot unit ${unit.id} must be within valid local bounds (0 <= x < 7, 0 <= y < 4)`
    );
    uniqueTiles.add(`${unit.x},${unit.y}`);
  }
  assert.equal(uniqueTiles.size, 9, 'Level 9 bot board must occupy 9 unique (x, y) tile coordinates');
});

test('getInterestGold awards +1g per 10g held and caps at +5g for 50g+', () => {
  assert.equal(getInterestGold(-5), 0);
  assert.equal(getInterestGold(0), 0);
  assert.equal(getInterestGold(9), 0);

  assert.equal(getInterestGold(10), 1);
  assert.equal(getInterestGold(19), 1);
  assert.equal(getInterestGold(20), 2);
  assert.equal(getInterestGold(35), 3);
  assert.equal(getInterestGold(49), 4);

  assert.equal(getInterestGold(50), 5);
  assert.equal(getInterestGold(85), 5);
});

test('getUnitSellValue returns UNIT_BASE_COST (3) for Knight and all 5 unit types', () => {
  assert.equal(UNIT_BASE_COST, 3);
  assert.equal(getUnitSellValue(createUnit('Knight', 'u1', 0, 0)), UNIT_BASE_COST);
  assert.equal(ALL_UNIT_TYPES.length, 5);
  for (const unitType of ALL_UNIT_TYPES) {
    assert.equal(
      getUnitSellValue(createUnit(unitType, `sell-${unitType}`, 0, 0)),
      UNIT_BASE_COST,
      `Sell value for ${unitType} must equal UNIT_BASE_COST (${UNIT_BASE_COST})`
    );
  }
});





