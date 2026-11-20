// src/components/CombatVisualizer.tsx

import React, { useEffect, useMemo, useState } from 'react';
import { BoardState, CombatEvent, PositionedUnit } from '../types/combat';
import {
  BOARD_COLS,
  SYNERGY_COLORS,
  TOTAL_ROWS,
  buildInwardSynergyRingShadow,
  calculateSynergies,
  getActiveSynergyColorsForUnit,
  projectToCombatBoard,
  resolveBoardWithSynergies,
} from '../engine/stats';

export interface CombatVisualizerProps {
  events: CombatEvent[];
  initialBoardA: BoardState;
  initialBoardB: BoardState;
  seed?: string;
  playerHp?: number;
  onRoundEnd?: (winner: string, damage: number, survivors: number) => void;
}

export interface VisualUnit extends PositionedUnit {
  team: 'A' | 'B';
}

function hydrateInitialUnits(
  boardA: BoardState,
  boardB: BoardState
): Record<string, VisualUnit> {
  const { units: resolvedA } = resolveBoardWithSynergies(boardA);
  const { units: resolvedB } = resolveBoardWithSynergies(boardB);

  const projectedA = projectToCombatBoard(resolvedA, 'A');
  const projectedB = projectToCombatBoard(resolvedB, 'B');

  const map: Record<string, VisualUnit> = {};
  projectedA.forEach((u) => {
    map[u.id] = { ...u, team: 'A' };
  });
  projectedB.forEach((u) => {
    map[u.id] = { ...u, team: 'B' };
  });
  return map;
}

export const CombatVisualizer: React.FC<CombatVisualizerProps> = ({
  events,
  initialBoardA,
  initialBoardB,
  seed,
  playerHp,
  onRoundEnd,
}) => {
  // Hydrate initial visual state dictionary keyed by unit ID using identical stat & projection pipeline
  const [unitsById, setUnitsById] = useState<Record<string, VisualUnit>>(() =>
    hydrateInitialUnits(initialBoardA, initialBoardB)
  );

  // Collapsible & scaffolded team-view states (scoped strictly to 'A' for now)
  const [viewedTeam] = useState<'A' | 'B'>('A');
  const [synergiesExpanded, setSynergiesExpanded] = useState<boolean>(false);
  const [timelineExpanded, setTimelineExpanded] = useState<boolean>(false);

  // Compute team synergies for viewedTeam
  const activeTeamSynergies = useMemo(
    () => calculateSynergies(viewedTeam === 'A' ? initialBoardA : initialBoardB),
    [viewedTeam, initialBoardA, initialBoardB]
  );
  const presentSynergies = useMemo(
    () => activeTeamSynergies.filter((s) => s.count > 0),
    [activeTeamSynergies]
  );

  // Extract all sorted unique ticks from the combat event tape
  const uniqueTicks = useMemo(() => {
    return Array.from(new Set(events.map((e) => e.tick))).sort((a, b) => a - b);
  }, [events]);

  const [tickIndex, setTickIndex] = useState<number>(0);
  const [damagedUnitIds, setDamagedUnitIds] = useState<Set<string>>(new Set());
  const [attackerUnitIds, setAttackerUnitIds] = useState<Set<string>>(new Set());
  const [winnerLabel, setWinnerLabel] = useState<string | null>(null);
  const [speedMs, setSpeedMs] = useState<number>(500);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  // Playback loop stepping through unique ticks with simultaneous event resolution
  useEffect(() => {
    if (isPaused) return;
    if (tickIndex >= uniqueTicks.length) return;

    const timer = setTimeout(() => {
      const currentTick = uniqueTicks[tickIndex];
      const tickEvents = events.filter((e) => e.tick === currentTick);

      const nextAttackers = new Set<string>();
      const nextDamaged = new Set<string>();
      let nextWinner: string | null = null;

      for (const ev of tickEvents) {
        if (ev.type === 'attack') {
          nextAttackers.add(ev.sourceId);
          nextDamaged.add(ev.targetId);
        } else if (ev.type === 'end') {
          nextWinner = ev.sourceId;
        }
      }

      setAttackerUnitIds(nextAttackers);
      setDamagedUnitIds(nextDamaged);
      if (nextWinner) {
        setWinnerLabel(nextWinner);
      }

      // Apply all state changes simultaneously in a single React state update
      setUnitsById((prev) => {
        const next = { ...prev };
        for (const ev of tickEvents) {
          if (ev.type === 'attack') {
            if (next[ev.targetId]) {
              next[ev.targetId] = {
                ...next[ev.targetId],
                hp: ev.remainingHp,
              };
            }
            if (next[ev.sourceId] && ev.attackerMana !== undefined) {
              next[ev.sourceId] = {
                ...next[ev.sourceId],
                mana: ev.attackerMana,
              };
            }
          } else if (ev.type === 'death') {
            delete next[ev.targetId];
          } else if (ev.type === 'move') {
            if (next[ev.sourceId]) {
              next[ev.sourceId] = {
                ...next[ev.sourceId],
                x: ev.newX!,
                y: ev.newY!,
              };
            }
          }
        }
        return next;
      });

      setTickIndex((prevIdx) => prevIdx + 1);
    }, speedMs);

    return () => clearTimeout(timer);
  }, [tickIndex, uniqueTicks, events, speedMs, isPaused]);

  const activeUnits = Object.values(unitsById);
  const currentTick = tickIndex > 0 ? uniqueTicks[tickIndex - 1] : uniqueTicks[0];
  const currentTickEvents = useMemo(() => {
    if (currentTick === undefined) return [];
    return events.filter((e) => e.tick === currentTick);
  }, [events, currentTick]);

  const endEvent = useMemo(() => {
    return events.find((e) => e.type === 'end');
  }, [events]);

  // Descending rows (y = 7 down to 0) so Team B (y=7..4) is top, Team A (y=3..0) is bottom, (0,0) is bottom-left
  const descendingRows = useMemo(() => {
    const rows: number[] = [];
    for (let y = TOTAL_ROWS - 1; y >= 0; y--) {
      rows.push(y);
    }
    return rows;
  }, []);

  const handleRestartPlayback = () => {
    setUnitsById(hydrateInitialUnits(initialBoardA, initialBoardB));
    setTickIndex(0);
    setDamagedUnitIds(new Set());
    setAttackerUnitIds(new Set());
    setWinnerLabel(null);
    setIsPaused(false);
  };

  const handleStepOnce = () => {
    if (tickIndex >= uniqueTicks.length) return;
    const targetTick = uniqueTicks[tickIndex];
    const tickEvents = events.filter((e) => e.tick === targetTick);

    const nextAttackers = new Set<string>();
    const nextDamaged = new Set<string>();
    let nextWinner: string | null = null;

    for (const ev of tickEvents) {
      if (ev.type === 'attack') {
        nextAttackers.add(ev.sourceId);
        nextDamaged.add(ev.targetId);
      } else if (ev.type === 'end') {
        nextWinner = ev.sourceId;
      }
    }

    setAttackerUnitIds(nextAttackers);
    setDamagedUnitIds(nextDamaged);
    if (nextWinner) setWinnerLabel(nextWinner);

    setUnitsById((prev) => {
      const next = { ...prev };
      for (const ev of tickEvents) {
        if (ev.type === 'attack') {
          if (next[ev.targetId]) {
            next[ev.targetId] = {
              ...next[ev.targetId],
              hp: ev.remainingHp,
            };
          }
          if (next[ev.sourceId] && ev.attackerMana !== undefined) {
            next[ev.sourceId] = {
              ...next[ev.sourceId],
              mana: ev.attackerMana,
            };
          }
        } else if (ev.type === 'death') {
          delete next[ev.targetId];
        } else if (ev.type === 'move') {
          if (next[ev.sourceId]) {
            next[ev.sourceId] = {
              ...next[ev.sourceId],
              x: ev.newX!,
              y: ev.newY!,
            };
          }
        }
      }
      return next;
    });

    setTickIndex((prev) => prev + 1);
  };

  const handleExportRoundJson = () => {
    const resolvedA = resolveBoardWithSynergies(initialBoardA);
    const resolvedB = resolveBoardWithSynergies(initialBoardB);

    const payload = {
      exportedAt: new Date().toISOString(),
      meta: {
        seed: seed ?? 'unknown',
        boardDimensions: { cols: BOARD_COLS, rows: TOTAL_ROWS },
        totalEvents: events.length,
        endEvent: events.find((e) => e.type === 'end') ?? null,
      },
      inputs: {
        boardA: initialBoardA,
        boardB: initialBoardB,
      },
      resolvedStart: {
        teamA: projectToCombatBoard(resolvedA.units, 'A'),
        teamB: projectToCombatBoard(resolvedB.units, 'B'),
        synergiesA: resolvedA.synergies,
        synergiesB: resolvedB.synergies,
      },
      events,
    };

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `round-${seed || 'match'}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

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
      {/* Primary Column (Battlefield — Majority Space) */}
      <div style={{ flex: '1 1 620px', minWidth: 0 }}>
        {/* Compact Top Bar: Playback Controls + Export JSON + Tick + Your HP Badge */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '8px',
            padding: '6px 8px',
            backgroundColor: '#1e293b',
            borderRadius: '8px',
            border: '1px solid #334155',
          }}
        >
          <button
            type="button"
            onClick={() => setIsPaused((p) => !p)}
            style={{
              padding: '4px 10px',
              fontSize: '0.76rem',
              fontWeight: 700,
              backgroundColor: isPaused ? '#2563eb' : '#334155',
              color: '#ffffff',
              border: isPaused ? 'none' : '1px solid #475569',
              borderRadius: '5px',
              cursor: 'pointer',
            }}
          >
            {isPaused ? '▶ Play' : '⏸ Pause'}
          </button>

          <button
            type="button"
            disabled={!isPaused || tickIndex >= uniqueTicks.length}
            onClick={handleStepOnce}
            style={{
              padding: '4px 8px',
              fontSize: '0.74rem',
              fontWeight: 600,
              backgroundColor: '#0f172a',
              color: '#f8fafc',
              border: '1px solid #475569',
              borderRadius: '5px',
              opacity: !isPaused || tickIndex >= uniqueTicks.length ? 0.45 : 1,
              cursor: !isPaused || tickIndex >= uniqueTicks.length ? 'not-allowed' : 'pointer',
            }}
          >
            Step ⏭
          </button>

          <button
            type="button"
            onClick={handleRestartPlayback}
            style={{
              padding: '4px 8px',
              fontSize: '0.74rem',
              fontWeight: 600,
              backgroundColor: '#0f172a',
              color: '#f8fafc',
              border: '1px solid #475569',
              borderRadius: '5px',
              cursor: 'pointer',
            }}
          >
            ↺ Replay
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.72rem', color: '#94a3b8' }}>
            {[
              { label: '0.5x', ms: 800 },
              { label: '1x', ms: 500 },
              { label: '2x', ms: 250 },
            ].map(({ label, ms }) => (
              <button
                key={label}
                type="button"
                onClick={() => setSpeedMs(ms)}
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  padding: '2px 6px',
                  backgroundColor: speedMs === ms ? '#2563eb' : '#0f172a',
                  color: speedMs === ms ? '#ffffff' : '#cbd5e1',
                  border: speedMs === ms ? '1px solid #3b82f6' : '1px solid #475569',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleExportRoundJson}
            style={{
              padding: '4px 8px',
              fontSize: '0.72rem',
              fontWeight: 600,
              backgroundColor: '#0f172a',
              color: '#f8fafc',
              border: '1px solid #475569',
              borderRadius: '5px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title="Download full deterministic round diagnostic JSON"
          >
            Export JSON
          </button>

          <span
            style={{
              fontSize: '0.74rem',
              fontWeight: 600,
              color: '#94a3b8',
              marginLeft: 'auto',
              whiteSpace: 'nowrap',
            }}
            title={seed ? `Deterministic PRNG Seed: ${seed}` : undefined}
          >
            Tick {currentTick ?? 0} ({tickIndex}/{uniqueTicks.length})
          </span>

          {playerHp !== undefined && (
            <span
              style={{
                fontSize: '0.76rem',
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: '6px',
                backgroundColor: playerHp > 10 ? '#052e16' : '#450a0a',
                border: `1px solid ${playerHp > 10 ? '#166534' : '#991b1b'}`,
                color: playerHp > 10 ? '#4ade80' : '#f87171',
                whiteSpace: 'nowrap',
              }}
            >
              Your HP: {playerHp}
            </span>
          )}
        </div>

        {/* Round End Banner */}
        {winnerLabel && (
          <div
            style={{
              padding: '8px 12px',
              marginBottom: '8px',
              backgroundColor: '#1e293b',
              border: `2px solid ${
                winnerLabel === 'TEAM_A'
                  ? '#38bdf8'
                  : winnerLabel === 'TEAM_B'
                  ? '#c084fc'
                  : '#facc15'
              }`,
              borderRadius: '8px',
              color: '#f8fafc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#f8fafc' }}>
                Combat Resolved — Winner: {winnerLabel}
              </div>
              <div style={{ fontSize: '0.76rem', color: '#cbd5e1', marginTop: '2px' }}>
                <span>
                  Damage Dealt: <strong style={{ color: '#f8fafc' }}>{endEvent?.winnerDamage ?? 1}</strong>
                </span>
                <span style={{ margin: '0 6px' }}>&bull;</span>
                <span>
                  Survivors: <strong style={{ color: '#f8fafc' }}>{endEvent?.survivorsCount ?? 0}</strong>
                </span>
              </div>
            </div>

            {onRoundEnd && (
              <button
                type="button"
                onClick={() => {
                  const winSource = endEvent ? endEvent.sourceId : winnerLabel;
                  const damage = endEvent?.winnerDamage ?? 1;
                  const survivors = endEvent?.survivorsCount ?? 0;
                  onRoundEnd(winSource, damage, survivors);
                }}
                style={{
                  padding: '6px 14px',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Next Round →
              </button>
            )}
          </div>
        )}

        {/* 7x8 Tan Combined Arena Grid (Rows 7-4: Team B Top, Rows 3-0: Team A Bottom, (0,0) Bottom-Left) */}
        <div
          role="grid"
          aria-label="7x8 Combat Arena Grid"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${BOARD_COLS}, minmax(0, 1fr))`,
            gap: '4px',
            backgroundColor: '#7c6246',
            padding: '6px',
            borderRadius: '10px',
            border: '2px solid #5c4732',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          {descendingRows.map((y) => (
            <React.Fragment key={`row-${y}`}>
              {Array.from({ length: BOARD_COLS }).map((_, x) => {
                const unit = activeUnits.find((u) => u.x === x && u.y === y);

                const isFlashingRed = Boolean(unit && damagedUnitIds.has(unit.id));
                const isAttacker = Boolean(unit && attackerUnitIds.has(unit.id));
                const isAbilityAttacker = Boolean(
                  unit &&
                    isAttacker &&
                    currentTickEvents.some(
                      (ev) => ev.type === 'attack' && ev.sourceId === unit.id && ev.isAbility
                    )
                );
                const healthPercent = unit ? Math.max(0, (unit.hp / unit.maxHp) * 100) : 0;
                const manaPercent = unit ? Math.max(0, (unit.mana / unit.maxMana) * 100) : 0;

                // Strictly scope inward active synergy rings to viewedTeam
                const isViewedTeamUnit =
                  Boolean(unit) &&
                  ((viewedTeam === 'A' && unit!.team === 'A') ||
                    (viewedTeam === 'B' && unit!.team === 'B'));
                const activeColors =
                  unit && isViewedTeamUnit
                    ? getActiveSynergyColorsForUnit(unit.tags, activeTeamSynergies)
                    : [];
                const ringShadow = buildInwardSynergyRingShadow(activeColors, 2);

                // Combat highlights live on the unit card's border so inward boxShadow synergy rings remain simultaneously legible
                const combatBorderColor = isFlashingRed
                  ? '#ef4444'
                  : isAttacker
                  ? isAbilityAttacker
                    ? '#a855f7'
                    : '#f59e0b'
                  : '#334155';

                return (
                  <div
                    key={`${x}-${y}`}
                    style={{
                      position: 'relative',
                      minWidth: 0,
                      overflow: 'hidden',
                      padding: '4px',
                      minHeight: '60px',
                      boxSizing: 'border-box',
                      border: y <= 3 ? '1px solid #a88f68' : '1px solid #9c845f',
                      borderRadius: '6px',
                      backgroundColor: y <= 3 ? '#d4bc96' : '#c7ae87',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {unit ? (
                      <div
                        style={{
                          backgroundColor: isFlashingRed ? '#450a0a' : '#1e293b',
                          color: '#f8fafc',
                          borderRadius: '6px',
                          width: '100%',
                          height: '100%',
                          boxSizing: 'border-box',
                          padding: '6px',
                          border: `2px solid ${combatBorderColor}`,
                          boxShadow: ringShadow,
                          transition: 'background-color 0.15s ease, border-color 0.15s ease',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '2px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: '100%',
                            lineHeight: 1.1,
                            color: '#f8fafc',
                          }}
                          title={`[Team ${unit.team}] ${unit.type}`}
                        >
                          <span
                            style={{
                              color: unit.team === 'A' ? '#4ade80' : '#f87171',
                              marginRight: '2px',
                            }}
                          >
                            {unit.team}·
                          </span>
                          {unit.type}
                        </div>

                        <div
                          style={{
                            fontSize: '0.62rem',
                            fontWeight: 600,
                            color: '#cbd5e1',
                            lineHeight: 1.1,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: '100%',
                          }}
                        >
                          {unit.hp}/{unit.maxHp}
                        </div>

                        {/* Crisp HP Bar (6px height, team-tinted fill: emerald Team A, coral/red Team B) */}
                        <div
                          style={{
                            width: '100%',
                            height: '6px',
                            backgroundColor: '#0f172a',
                            borderRadius: '3px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${healthPercent}%`,
                              height: '100%',
                              backgroundColor: unit.team === 'A' ? '#22c55e' : '#ef4444',
                              transition: 'width 0.2s ease',
                            }}
                          />
                        </div>

                        {/* Mana Bar (4px height) */}
                        <div
                          style={{
                            width: '100%',
                            height: '4px',
                            backgroundColor: '#0f172a',
                            borderRadius: '2px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${manaPercent}%`,
                              height: '100%',
                              backgroundColor: '#38bdf8',
                              transition: 'width 0.2s ease',
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <span
                        style={{
                          fontSize: '0.55rem',
                          color: '#5c4732',
                          opacity: 0.65,
                          userSelect: 'none',
                        }}
                      >
                        ({x},{y})
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Horizontal divider between Team B frontline (y = 4) and Team A frontline (y = 3) */}
              {y === 4 && (
                <div
                  key="frontline-divider"
                  style={{
                    gridColumn: '1 / -1',
                    borderTop: '2px dashed #5c4732',
                    margin: '2px 0',
                  }}
                  aria-label="Frontline Boundary"
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Secondary Column (Informational Viewports Stack — Starts Minimized) */}
      <div
        style={{
          flex: synergiesExpanded || timelineExpanded ? '0 1 300px' : '0 1 220px',
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {/* Top Panel — Battle Synergies Quick-Look */}
        <div
          style={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '8px 10px',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.25)',
          }}
        >
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
              Your Synergies
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

          {!synergiesExpanded ? (
            presentSynergies.length === 0 ? (
              <div style={{ fontSize: '0.74rem', color: '#94a3b8', fontStyle: 'italic' }}>
                No active synergies
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {activeTeamSynergies.map((synergy) => {
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

        {/* Bottom Panel (Directly Underneath Synergies) — Event Timeline */}
        <div
          style={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.25)',
          }}
        >
          <button
            type="button"
            onClick={() => setTimelineExpanded((prev) => !prev)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              padding: '8px 10px',
              backgroundColor: '#1e293b',
              border: 'none',
              borderBottom: timelineExpanded ? '1px solid #334155' : 'none',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc' }}>
              Event Timeline ({events.length})
            </span>
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                color: '#94a3b8',
                whiteSpace: 'nowrap',
              }}
            >
              {timelineExpanded ? 'Minimize ▾' : 'Expand ▸'}
            </span>
          </button>

          {timelineExpanded && (
            <div
              style={{
                backgroundColor: '#0f172a',
                color: '#e2e8f0',
                padding: '8px',
                maxHeight: '320px',
                overflowY: 'auto',
                fontSize: '0.73rem',
                fontFamily: 'monospace',
              }}
            >
              {uniqueTicks.map((tickNum) => {
                const isCurrent = tickNum === currentTick;
                const evsAtTick = events.filter((e) => e.tick === tickNum);
                const attackDescs = evsAtTick
                  .filter((e) => e.type === 'attack')
                  .map((ev) => (ev.isAbility ? `CAST ${ev.abilityName}` : 'attack'));
                const deathCount = evsAtTick.filter((e) => e.type === 'death').length;
                const endEv = evsAtTick.find((e) => e.type === 'end');
                const moveCount = evsAtTick.filter((e) => e.type === 'move').length;

                return (
                  <div
                    key={tickNum}
                    style={{
                      padding: '4px 6px',
                      borderRadius: '4px',
                      marginBottom: '2px',
                      backgroundColor: isCurrent ? '#2563eb' : 'transparent',
                      color: isCurrent
                        ? '#ffffff'
                        : endEv
                        ? '#fde047'
                        : deathCount > 0
                        ? '#f87171'
                        : '#94a3b8',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '6px',
                      fontSize: '0.72rem',
                    }}
                  >
                    <span>
                      Tick {tickNum}:{' '}
                      {attackDescs.length > 0
                        ? attackDescs.join(', ')
                        : moveCount > 0
                        ? `${moveCount} move`
                        : ''}
                    </span>
                    <span style={{ whiteSpace: 'nowrap' }}>
                      {deathCount > 0 && `☠️ ${deathCount} death${deathCount > 1 ? 's' : ''} `}
                      {endEv && `🏆 ${endEv.sourceId} (Dmg: ${endEv.winnerDamage ?? 1})`}
                    </span>
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
