// src/components/BoardBuilder.tsx

import React, { useMemo, useState } from 'react';
import { BoardState, PositionedUnit, StreakState, UnitType } from '../types/combat';
import {
  ALL_UNIT_TYPES,
  BOARD_COLS,
  MAX_INTEREST_GOLD,
  MAX_LEVEL,
  SIDE_ROWS,
  SYNERGY_COLORS,
  UNIT_BASE_COST,
  UNIT_TEMPLATES,
  XP_TO_NEXT_LEVEL,
  applyXpGain,
  buildInwardSynergyRingShadow,
  calculateSynergies,
  createUnit,
  generateRandomShop,
  getActiveSynergyColorsForUnit,
  getInterestGold,
  getStreakBonusGold,
  getUnitSellValue,
  resolveBoardWithSynergies,
} from '../engine/stats';

export interface BoardBuilderProps {
  onLockIn: (board: BoardState, bench: PositionedUnit[]) => void;
  disabled?: boolean;
  initialBoard?: BoardState;
  initialBench?: PositionedUnit[];
  title?: string;
  lockInButtonLabel?: string;
  mode?: 'sandbox' | 'draft';
  gold: number;
  setGold: React.Dispatch<React.SetStateAction<number>>;
  playerHp: number;
  enemyHp?: number;
  level?: number;
  setLevel?: React.Dispatch<React.SetStateAction<number>>;
  xp?: number;
  setXp?: React.Dispatch<React.SetStateAction<number>>;
  streak?: StreakState;
}

export const BoardBuilder: React.FC<BoardBuilderProps> = ({
  onLockIn,
  disabled = false,
  initialBoard,
  initialBench,
  title,
  lockInButtonLabel,
  mode = 'sandbox',
  gold,
  setGold,
  playerHp,
  level,
  setLevel,
  xp,
  setXp,
  streak,
}) => {
  const [selectedUnitType, setSelectedUnitType] = useState<UnitType>('Knight');
  const [synergiesExpanded, setSynergiesExpanded] = useState<boolean>(false);

  // Drafting and economy state
  const [localLevel, setLocalLevel] = useState<number>(1);
  const activeLevel = level ?? localLevel;
  const activeSetLevel = setLevel ?? setLocalLevel;
  const [localXp, setLocalXp] = useState<number>(0);
  const activeXp = xp ?? localXp;
  const activeSetXp = setXp ?? setLocalXp;
  const [shop, setShop] = useState<(UnitType | null)[]>(() => generateRandomShop(3));
  const [bench, setBench] = useState<PositionedUnit[]>(() => initialBench || []);
  const [selectedBenchId, setSelectedBenchId] = useState<string | null>(null);
  const [isSellMode, setIsSellMode] = useState<boolean>(false);

  const [board, setBoard] = useState<BoardState>(() =>
    initialBoard !== undefined
      ? initialBoard
      : mode === 'draft'
      ? []
      : [
          createUnit('Knight', crypto.randomUUID(), 2, 3),
          createUnit('Archer', crypto.randomUUID(), 3, 0),
          createUnit('Knight', crypto.randomUUID(), 4, 3),
        ]
  );

  // Drafting Handlers
  const handleReroll = () => {
    if (disabled || gold < 2) return;
    setGold((g) => g - 2);
    setShop(generateRandomShop(3));
  };

  const handleBuyXp = () => {
    if (disabled || gold < 4 || activeLevel >= MAX_LEVEL) return;
    setGold((g) => g - 4);
    const next = applyXpGain(activeLevel, activeXp, 4);
    activeSetLevel(next.level);
    activeSetXp(next.xp);
  };

  const handleBuyUnit = (index: number) => {
    if (disabled) return;
    const unitType = shop[index];
    if (gold >= UNIT_BASE_COST && unitType !== null && bench.length < 5) {
      const newUnit = createUnit(unitType, crypto.randomUUID(), -1, -1);
      setGold((g) => g - UNIT_BASE_COST);
      setBench((prev) => [...prev, newUnit]);
      setShop((prev) => {
        const next = [...prev];
        next[index] = null;
        return next;
      });
    }
  };

  const handleSellUnit = (unitId: string, source: 'board' | 'bench') => {
    if (disabled || mode !== 'draft') return;
    const targetUnit =
      source === 'board'
        ? board.find((u) => u.id === unitId)
        : bench.find((u) => u.id === unitId);
    if (!targetUnit) return;

    const refund = getUnitSellValue(targetUnit);
    if (source === 'board') {
      setBoard((prev) => prev.filter((u) => u.id !== unitId));
    } else {
      setBench((prev) => prev.filter((u) => u.id !== unitId));
    }
    setGold((prev) => prev + refund);
    if (selectedBenchId === unitId) {
      setSelectedBenchId(null);
    }
  };

  const handleCellClick = (x: number, y: number) => {
    if (disabled) return;

    if (mode === 'sandbox') {
      setBoard((prevBoard) => {
        const existingIndex = prevBoard.findIndex((u) => u.x === x && u.y === y);

        // Clicking an occupied cell removes the unit
        if (existingIndex !== -1) {
          return prevBoard.filter((_, idx) => idx !== existingIndex);
        }

        // Clicking an empty cell places the selected unit
        const newUnit = createUnit(selectedUnitType, crypto.randomUUID(), x, y);
        return [...prevBoard, newUnit];
      });
      return;
    }

    // Draft mode
    const occupiedUnit = board.find((u) => u.x === x && u.y === y);
    if (isSellMode) {
      if (occupiedUnit) {
        handleSellUnit(occupiedUnit.id, 'board');
      }
      return;
    }

    if (occupiedUnit) {
      if (bench.length < 5) {
        setBoard((prev) => prev.filter((u) => u.id !== occupiedUnit.id));
        setBench((prev) => [...prev, { ...occupiedUnit, x: -1, y: -1 }]);
      }
      return;
    }

    if (selectedBenchId && board.length < activeLevel) {
      const benchUnit = bench.find((u) => u.id === selectedBenchId);
      if (benchUnit) {
        setBench((prev) => prev.filter((u) => u.id !== selectedBenchId));
        setBoard((prev) => [...prev, { ...benchUnit, x, y }]);
        setSelectedBenchId(null);
      }
    }
  };

  const handleClear = () => {
    if (disabled) return;
    setBoard([]);
  };

  const handlePreset = (presetType: 'balanced' | 'archers' | 'knights') => {
    if (disabled) return;
    if (presetType === 'balanced') {
      setBoard([
        createUnit('Knight', crypto.randomUUID(), 2, 3),
        createUnit('Knight', crypto.randomUUID(), 4, 3),
        createUnit('Archer', crypto.randomUUID(), 3, 0),
      ]);
    } else if (presetType === 'archers') {
      setBoard([
        createUnit('Archer', crypto.randomUUID(), 1, 0),
        createUnit('Archer', crypto.randomUUID(), 3, 0),
        createUnit('Archer', crypto.randomUUID(), 5, 0),
      ]);
    } else {
      setBoard([
        createUnit('Knight', crypto.randomUUID(), 2, 3),
        createUnit('Knight', crypto.randomUUID(), 3, 3),
        createUnit('Knight', crypto.randomUUID(), 4, 3),
      ]);
    }
  };

  // Compute synergies and resolved stats for preview without mutating board state
  const currentSynergies = useMemo(() => calculateSynergies(board), [board]);
  const presentSynergies = useMemo(
    () => currentSynergies.filter((s) => s.count > 0),
    [currentSynergies]
  );
  const { units: resolvedBoard } = useMemo(() => resolveBoardWithSynergies(board), [board]);

  // Descending y (3 -> 0) and ascending x (0 -> 6) so (0,0) is bottom-left and y=3 is frontline
  const gridCells = useMemo(() => {
    const cells: { x: number; y: number }[] = [];
    for (let y = SIDE_ROWS - 1; y >= 0; y--) {
      for (let x = 0; x < BOARD_COLS; x++) {
        cells.push({ x, y });
      }
    }
    return cells;
  }, []);

  const getSynergyBadgeLabel = (tag: string, activeTier: number): string => {
    if (tag === 'Human') {
      if (activeTier >= 2) return 'Tier 2 (+200 Max HP)';
      if (activeTier === 1) return 'Tier 1 (+100 Max HP)';
      return 'Inactive';
    }
    if (tag === 'Elf') {
      return activeTier > 0 ? 'Active (+25% Atk Spd)' : 'Inactive';
    }
    return activeTier > 0 ? 'Active (+10 Mana/Hit)' : 'Inactive';
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        alignItems: 'flex-start',
        width: '100%',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Primary Column (Gameplay — Majority Space) */}
      <div style={{ flex: '1 1 620px', minWidth: 0 }}>
        {title && (
          <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 8px 0', color: '#f8fafc' }}>
            {title}
          </h2>
        )}

        {/* Compact Top HUD Bar (Draft Mode) */}
        {mode === 'draft' && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              padding: '8px 10px',
              marginBottom: '8px',
              backgroundColor: '#1e293b',
              borderRadius: '8px',
              border: '1px solid #334155',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.82rem',
                fontWeight: 700,
                color: '#f8fafc',
              }}
            >
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: '6px',
                  backgroundColor: playerHp > 10 ? '#052e16' : '#450a0a',
                  border: `1px solid ${playerHp > 10 ? '#166534' : '#991b1b'}`,
                  color: playerHp > 10 ? '#4ade80' : '#f87171',
                }}
              >
                Your HP: {playerHp}
              </span>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: '6px',
                  backgroundColor: '#451a03',
                  border: '1px solid #92400e',
                  color: '#fbbf24',
                }}
              >
                Gold: {gold}g
              </span>
              {(() => {
                const currentInterest = getInterestGold(gold);
                return (
                  <span
                    title={`Interest: +1g per 10g held (max +${MAX_INTEREST_GOLD}g at 50g)`}
                    style={{
                      padding: '3px 7px',
                      borderRadius: '6px',
                      backgroundColor: '#0f172a',
                      border: `1px solid ${currentInterest > 0 ? '#92400e' : '#334155'}`,
                      color: currentInterest > 0 ? '#fbbf24' : '#94a3b8',
                      fontSize: '0.76rem',
                      fontWeight: 600,
                      cursor: 'help',
                    }}
                  >
                    (+{currentInterest}g int)
                  </span>
                );
              })()}
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: '6px',
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  color: '#38bdf8',
                }}
              >
                Lv. {activeLevel} ({board.length}/{activeLevel}) &bull;{' '}
                {activeLevel >= MAX_LEVEL
                  ? 'MAX'
                  : `XP: ${activeXp}/${XP_TO_NEXT_LEVEL[activeLevel]}`}
              </span>
              {streak && streak.type !== 'none' && (() => {
                const bonus = getStreakBonusGold(streak);
                const isWin = streak.type === 'win';
                return (
                  <span
                    style={{
                      padding: '3px 8px',
                      borderRadius: '6px',
                      backgroundColor: isWin ? '#052e16' : '#450a0a',
                      border: `1px solid ${isWin ? '#166534' : '#991b1b'}`,
                      color: isWin ? '#4ade80' : '#f87171',
                    }}
                  >
                    {isWin ? 'Win Streak' : 'Loss Streak'}: {streak.count}
                    {bonus > 0 ? ` (+${bonus}g)` : ''}
                  </span>
                );
              })()}
            </div>

            <button
              type="button"
              onClick={() => {
                setIsSellMode(false);
                onLockIn(board, bench);
              }}
              disabled={disabled}
              style={{
                padding: '6px 14px',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 700,
                fontSize: '0.82rem',
                opacity: disabled ? 0.45 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
              title="Lock in current board (0 units allowed)"
            >
              {disabled
                ? 'Searching...'
                : lockInButtonLabel || `Lock In & Battle (${board.length})`}
            </button>
          </div>
        )}

        {/* Compact Sandbox Controls (Sandbox Mode) */}
        {mode === 'sandbox' && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px',
              padding: '8px',
              marginBottom: '8px',
              backgroundColor: '#1e293b',
              borderRadius: '8px',
              border: '1px solid #334155',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
              {ALL_UNIT_TYPES.map((type) => {
                const template = UNIT_TEMPLATES[type];
                const isSelected = selectedUnitType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    disabled={disabled}
                    onClick={() => setSelectedUnitType(type)}
                    style={{
                      padding: '4px 8px',
                      fontSize: '0.72rem',
                      fontWeight: isSelected ? 700 : 600,
                      backgroundColor: isSelected ? '#2563eb' : '#0f172a',
                      color: isSelected ? '#ffffff' : '#f8fafc',
                      border: isSelected ? '1px solid #3b82f6' : '1px solid #475569',
                      borderRadius: '6px',
                      opacity: disabled ? 0.45 : 1,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                    title={`HP:${template.baseStats.maxHp} | ATK:${template.baseStats.attack} | SPD:${template.baseStats.atkSpeed} | MP:${template.baseStats.maxMana} | RNG:${template.baseStats.attackRange} [${template.tags.join(', ')}]`}
                  >
                    {type} ({template.baseStats.maxHp}/{template.baseStats.attack})
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => handlePreset('balanced')}
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  padding: '4px 7px',
                  backgroundColor: '#334155',
                  color: '#f8fafc',
                  border: '1px solid #475569',
                  borderRadius: '5px',
                  opacity: disabled ? 0.45 : 1,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                Balanced
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => handlePreset('archers')}
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  padding: '4px 7px',
                  backgroundColor: '#334155',
                  color: '#f8fafc',
                  border: '1px solid #475569',
                  borderRadius: '5px',
                  opacity: disabled ? 0.45 : 1,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                Archers
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => handlePreset('knights')}
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  padding: '4px 7px',
                  backgroundColor: '#334155',
                  color: '#f8fafc',
                  border: '1px solid #475569',
                  borderRadius: '5px',
                  opacity: disabled ? 0.45 : 1,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                Knights
              </button>
              <button
                type="button"
                disabled={disabled || board.length === 0}
                onClick={handleClear}
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  padding: '4px 7px',
                  backgroundColor: '#450a0a',
                  color: '#fca5a5',
                  border: '1px solid #991b1b',
                  borderRadius: '5px',
                  opacity: disabled || board.length === 0 ? 0.45 : 1,
                  cursor: disabled || board.length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => onLockIn(board, bench)}
                disabled={disabled}
                style={{
                  padding: '4px 10px',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '5px',
                  fontWeight: 700,
                  fontSize: '0.74rem',
                  opacity: disabled ? 0.45 : 1,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
                title="Lock in current board (0 units allowed)"
              >
                {disabled
                  ? 'Searching...'
                  : lockInButtonLabel || `Lock In (${board.length})`}
              </button>
            </div>
          </div>
        )}

        {/* 7x4 Tan Tactical Grid (Frontline y=3 top, Backline y=0 bottom, (0,0) bottom-left) */}
        <div
          role="grid"
          aria-label="Tactical 7x4 Grid"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${BOARD_COLS}, minmax(0, 1fr))`,
            gap: '4px',
            marginBottom: '10px',
            backgroundColor: '#7c6246',
            padding: '6px',
            borderRadius: '10px',
            border: '2px solid #5c4732',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          {gridCells.map(({ x, y }) => {
            const occupant = resolvedBoard.find((u) => u.x === x && u.y === y);
            const isHpBuffed = Boolean(occupant && occupant.maxHp > occupant.baseStats.maxHp);
            const activeColors = occupant
              ? getActiveSynergyColorsForUnit(occupant.tags, currentSynergies)
              : [];
            const ringShadow = buildInwardSynergyRingShadow(activeColors, 2);

            return (
              <button
                key={`${x}-${y}`}
                type="button"
                aria-label={
                  occupant
                    ? `Cell ${x}, ${y}: ${occupant.type} with ${occupant.maxHp} Max HP, ${occupant.attack} ATK`
                    : `Empty cell ${x}, ${y}`
                }
                onClick={() => handleCellClick(x, y)}
                disabled={disabled}
                style={{
                  position: 'relative',
                  minWidth: 0,
                  overflow: 'hidden',
                  padding: '4px',
                  minHeight: '64px',
                  border: '1px solid #a88f68',
                  borderRadius: '6px',
                  backgroundColor: '#d4bc96',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  userSelect: 'none',
                  boxSizing: 'border-box',
                  transition: 'background-color 0.12s ease',
                }}
              >
                {occupant ? (
                  <div
                    style={{
                      position: 'relative',
                      backgroundColor: '#1e293b',
                      color: '#f8fafc',
                      borderRadius: '6px',
                      width: '100%',
                      height: '100%',
                      boxSizing: 'border-box',
                      padding: '6px',
                      boxShadow: ringShadow,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '1px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        color: '#f8fafc',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '100%',
                        lineHeight: 1.15,
                      }}
                    >
                      {occupant.type}
                    </div>
                    <div
                      style={{
                        fontSize: '0.64rem',
                        fontWeight: 700,
                        color: isHpBuffed ? '#4ade80' : '#e2e8f0',
                        backgroundColor: isHpBuffed ? 'rgba(74, 222, 128, 0.16)' : 'transparent',
                        borderRadius: '3px',
                        padding: isHpBuffed ? '0 3px' : '0',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '100%',
                        lineHeight: 1.15,
                      }}
                    >
                      HP {occupant.maxHp}
                    </div>
                    <div
                      style={{
                        fontSize: '0.6rem',
                        fontWeight: 600,
                        color: '#94a3b8',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '100%',
                        lineHeight: 1.1,
                      }}
                    >
                      ATK {occupant.attack}
                    </div>
                    {mode === 'draft' && isSellMode && (
                      <span
                        style={{
                          marginTop: '2px',
                          padding: '1px 4px',
                          borderRadius: '3px',
                          backgroundColor: '#dc2626',
                          color: '#ffffff',
                          fontSize: '0.6rem',
                          fontWeight: 700,
                          lineHeight: 1.15,
                          whiteSpace: 'nowrap',
                          maxWidth: '100%',
                        }}
                      >
                        Sell +{getUnitSellValue(occupant)}g
                      </span>
                    )}
                    <span
                      style={{
                        position: 'absolute',
                        bottom: '2px',
                        right: '3px',
                        fontSize: '0.52rem',
                        color: '#94a3b8',
                        opacity: 0.45,
                        pointerEvents: 'none',
                        lineHeight: 1,
                      }}
                    >
                      ({x},{y})
                    </span>
                  </div>
                ) : (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: '2px',
                      right: '3px',
                      fontSize: '0.55rem',
                      color: '#5c4732',
                      opacity: 0.65,
                      pointerEvents: 'none',
                      lineHeight: 1,
                    }}
                  >
                    ({x},{y})
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Bench (1x5) & Compact Shop Row directly beneath the 7x4 grid (Draft Mode) */}
        {mode === 'draft' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Bench (1x5) */}
            <div
              style={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '6px 8px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '4px',
                  gap: '6px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#f8fafc' }}>
                    Bench ({bench.length}/5)
                  </span>
                  {!isSellMode && selectedBenchId !== null && (() => {
                    const selectedUnit = bench.find((u) => u.id === selectedBenchId);
                    if (!selectedUnit) return null;
                    return (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleSellUnit(selectedUnit.id, 'bench')}
                        style={{
                          padding: '2px 8px',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          backgroundColor: '#dc2626',
                          color: '#ffffff',
                          border: '1px solid #ef4444',
                          borderRadius: '5px',
                          opacity: disabled ? 0.45 : 1,
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Sell {selectedUnit.type} (+{getUnitSellValue(selectedUnit)}g)
                      </button>
                    );
                  })()}
                </div>
                <span style={{ fontSize: '0.68rem', color: isSellMode ? '#fca5a5' : '#94a3b8' }}>
                  {isSellMode
                    ? 'Sell Mode ON: tap any board or bench unit to sell'
                    : selectedBenchId
                    ? 'Tap an empty board tile to deploy'
                    : 'Tap bench unit to deploy, or board unit to recall (0 units allowed)'}
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                  gap: '6px',
                  width: '100%',
                }}
              >
                {Array.from({ length: 5 }).map((_, i) => {
                  const unit = bench[i];
                  const isSelected = Boolean(unit && unit.id === selectedBenchId);

                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={disabled || !unit}
                      onClick={() => {
                        if (!unit) return;
                        if (isSellMode) {
                          handleSellUnit(unit.id, 'bench');
                          return;
                        }
                        setSelectedBenchId(isSelected ? null : unit.id);
                      }}
                      style={{
                        minWidth: 0,
                        minHeight: '48px',
                        overflow: 'hidden',
                        border: isSelected
                          ? '2px solid #f59e0b'
                          : unit
                          ? isSellMode
                            ? '1px solid #ef4444'
                            : '1px solid #475569'
                          : '1px dashed #475569',
                        borderRadius: '6px',
                        backgroundColor: isSelected ? '#451a03' : '#0f172a',
                        padding: '4px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: unit && !disabled ? 'pointer' : 'default',
                        boxShadow: isSelected ? '0 0 8px rgba(245, 158, 11, 0.45)' : 'none',
                        transition: 'all 0.12s ease',
                      }}
                    >
                      {unit ? (
                        <>
                          <strong
                            style={{
                              fontSize: '0.7rem',
                              color: '#f8fafc',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: '100%',
                            }}
                          >
                            {unit.type}
                          </strong>
                          <span style={{ fontSize: '0.6rem', color: '#94a3b8' }}>
                            HP {unit.maxHp}
                          </span>
                          {isSellMode && (
                            <span
                              style={{
                                marginTop: '2px',
                                padding: '1px 4px',
                                borderRadius: '3px',
                                backgroundColor: '#dc2626',
                                color: '#ffffff',
                                fontSize: '0.6rem',
                                fontWeight: 700,
                                lineHeight: 1.15,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Sell +{getUnitSellValue(unit)}g
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{ fontSize: '0.65rem', color: '#475569' }}>{i + 1}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Compact Shop Row with Inline Reroll & Buy XP */}
            <div
              style={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '6px 8px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                alignItems: 'stretch',
              }}
            >
              <div
                style={{
                  flex: '1 1 360px',
                  minWidth: 0,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: '6px',
                }}
              >
                {shop.map((unitType, i) => {
                  if (!unitType) {
                    return (
                      <div
                        key={i}
                        style={{
                          minWidth: 0,
                          border: '1px dashed #475569',
                          borderRadius: '6px',
                          padding: '6px',
                          minHeight: '68px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: '#0f172a',
                          color: '#64748b',
                          fontSize: '0.72rem',
                        }}
                      >
                        Sold
                      </div>
                    );
                  }

                  const template = UNIT_TEMPLATES[unitType];
                  const canBuy = gold >= UNIT_BASE_COST && bench.length < 5 && !disabled;

                  return (
                    <div
                      key={i}
                      style={{
                        minWidth: 0,
                        overflow: 'hidden',
                        border: '1px solid #334155',
                        borderRadius: '6px',
                        padding: '6px',
                        backgroundColor: '#0f172a',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '4px',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: '0.76rem',
                            color: '#f8fafc',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {unitType}
                        </div>
                        <div
                          style={{
                            fontSize: '0.62rem',
                            color: '#c084fc',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {template.tags.join(' · ')}
                        </div>
                        <div
                          style={{
                            fontSize: '0.62rem',
                            color: '#94a3b8',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          HP:{template.baseStats.maxHp} ATK:{template.baseStats.attack}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={!canBuy}
                        onClick={() => handleBuyUnit(i)}
                        style={{
                          padding: '3px 6px',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          backgroundColor: canBuy ? '#2563eb' : '#334155',
                          color: canBuy ? '#ffffff' : '#94a3b8',
                          border: canBuy ? 'none' : '1px solid #475569',
                          borderRadius: '4px',
                          opacity: canBuy ? 1 : 0.45,
                          cursor: canBuy ? 'pointer' : 'not-allowed',
                          width: '100%',
                        }}
                      >
                        Buy ({UNIT_BASE_COST}G)
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Inline Economy Actions */}
              <div
                style={{
                  flex: '0 1 154px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  justifyContent: 'stretch',
                }}
              >
                <button
                  type="button"
                  disabled={disabled || gold < 2}
                  onClick={handleReroll}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    backgroundColor: '#334155',
                    color: '#f8fafc',
                    border: '1px solid #475569',
                    borderRadius: '6px',
                    opacity: gold >= 2 && !disabled ? 1 : 0.45,
                    cursor: gold >= 2 && !disabled ? 'pointer' : 'not-allowed',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Reroll (2G)
                </button>
                <button
                  type="button"
                  disabled={disabled || gold < 4 || activeLevel >= MAX_LEVEL}
                  onClick={handleBuyXp}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    backgroundColor: '#334155',
                    color: '#f8fafc',
                    border: '1px solid #475569',
                    borderRadius: '6px',
                    opacity: gold >= 4 && activeLevel < MAX_LEVEL && !disabled ? 1 : 0.45,
                    cursor: gold >= 4 && activeLevel < MAX_LEVEL && !disabled ? 'pointer' : 'not-allowed',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {activeLevel >= MAX_LEVEL ? 'Max Level' : 'Buy XP (4G -> +4 XP)'}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setIsSellMode((prev) => {
                      const next = !prev;
                      if (next) {
                        setSelectedBenchId(null);
                      }
                      return next;
                    });
                  }}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    backgroundColor: isSellMode ? '#dc2626' : '#334155',
                    color: isSellMode ? '#ffffff' : '#f8fafc',
                    border: isSellMode ? '1px solid #ef4444' : '1px solid #475569',
                    borderRadius: '6px',
                    opacity: disabled ? 0.45 : 1,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isSellMode ? 'Sell Mode: ON (Tap Unit)' : 'Sell Mode: OFF'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Secondary Column (Informational Viewport — Starts Minimized) */}
      <div
        style={{
          flex: synergiesExpanded ? '0 1 300px' : '0 1 220px',
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
        }}
      >
        <div
          style={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '8px 10px',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.25)',
          }}
        >
          {/* Card Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              marginBottom: '8px',
            }}
          >
            <h3 style={{ fontSize: '0.84rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              Synergies
            </h3>
            <button
              type="button"
              onClick={() => setSynergiesExpanded((prev) => !prev)}
              style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                padding: '2px 7px',
                backgroundColor: '#0f172a',
                color: '#f8fafc',
                border: '1px solid #475569',
                borderRadius: '4px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {synergiesExpanded ? 'Minimize ▾' : 'Expand ▸'}
            </button>
          </div>

          {/* Minimized Quick-Look Pills with Ring Color Legend Dots */}
          {!synergiesExpanded ? (
            presentSynergies.length === 0 ? (
              <div style={{ fontSize: '0.74rem', color: '#94a3b8', fontStyle: 'italic' }}>
                No units placed
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {presentSynergies.map((synergy) => {
                  const maxThreshold = synergy.thresholds[synergy.thresholds.length - 1];
                  const synColor = SYNERGY_COLORS[synergy.tag] || '#94a3b8';
                  const isActive = synergy.activeTier > 0;
                  return (
                    <span
                      key={synergy.tag}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontSize: '0.72rem',
                        fontWeight: isActive ? 700 : 600,
                        padding: '3px 8px',
                        borderRadius: '999px',
                        backgroundColor: '#0f172a',
                        border: `1px solid ${isActive ? synColor : '#475569'}`,
                        color: isActive ? '#f8fafc' : '#94a3b8',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: synColor,
                          display: 'inline-block',
                          flexShrink: 0,
                        }}
                      />
                      {synergy.tag} {synergy.count}/{maxThreshold}
                    </span>
                  );
                })}
              </div>
            )
          ) : (
            /* Expanded Synergy Details with Ring Color Legend Dots */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {currentSynergies.map((synergy) => {
                const maxThreshold = synergy.thresholds[synergy.thresholds.length - 1];
                const synColor = SYNERGY_COLORS[synergy.tag] || '#94a3b8';
                const isActive = synergy.activeTier > 0;
                const badgeLabel = getSynergyBadgeLabel(synergy.tag, synergy.activeTier);
                return (
                  <div
                    key={synergy.tag}
                    style={{
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: `1px solid ${isActive ? synColor : '#334155'}`,
                      backgroundColor: '#0f172a',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <strong
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '0.78rem',
                          color: isActive ? synColor : '#e2e8f0',
                        }}
                      >
                        <span
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: synColor,
                            display: 'inline-block',
                            flexShrink: 0,
                          }}
                        />
                        {synergy.tag} ({synergy.count}/{maxThreshold})
                      </strong>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          padding: '2px 5px',
                          borderRadius: '4px',
                          backgroundColor: isActive ? synColor : '#334155',
                          color: isActive ? '#0f172a' : '#94a3b8',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {badgeLabel}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '3px' }}>
                      Tiers: {synergy.thresholds.join(' / ')} &bull; {synergy.description}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
