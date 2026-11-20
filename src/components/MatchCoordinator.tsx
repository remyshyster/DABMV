// src/components/MatchCoordinator.tsx

import React, { useEffect, useState } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { BoardState, CombatEvent, PositionedUnit, StreakState } from '../types/combat';
import { simulateCombat } from '../engine/simulateCombat';
import {
  applyXpGain,
  createUnit,
  generateBotBoard,
  getBotLevelForRound,
  getInterestGold,
  getStreakBonusGold,
  updateStreak,
} from '../engine/stats';
import { BoardBuilder } from './BoardBuilder';
import { CombatVisualizer } from './CombatVisualizer';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key';

// Only instantiate real Supabase client if URL is provided
const isConfiguredSupabase =
  SUPABASE_URL &&
  !SUPABASE_URL.includes('your-project.supabase.co') &&
  SUPABASE_ANON_KEY &&
  SUPABASE_ANON_KEY !== 'your-anon-key';

let supabase: SupabaseClient | null = null;
try {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
  console.warn('Supabase client initialization warning:', err);
}

interface MatchRow {
  id: string;
  status: 'waiting' | 'ready';
  board_a: BoardState;
  board_b: BoardState | null;
  seed: string;
}

export type MatchMode = 'instant' | 'dual' | 'supabase';

export const MatchCoordinator: React.FC = () => {
  const [matchMode, setMatchMode] = useState<MatchMode>('instant');
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [matchStatus, setMatchStatus] = useState<'menu' | 'idle' | 'waiting' | 'ready' | 'game_over'>('menu');
  const [combatLog, setCombatLog] = useState<CombatEvent[] | null>(null);
  const [activeSeed, setActiveSeed] = useState<string>('');
  const [customSeedInput, setCustomSeedInput] = useState<string>('match-' + Math.floor(Math.random() * 90000 + 10000));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Lifted multi-round game loop states
  const [playerHp, setPlayerHp] = useState<number>(30);
  const [enemyHp, setEnemyHp] = useState<number>(30);
  const [gold, setGold] = useState<number>(12);
  const [level, setLevel] = useState<number>(1);
  const [xp, setXp] = useState<number>(0);
  const [streak, setStreak] = useState<StreakState>({ type: 'none', count: 0 });
  const [roundNumber, setRoundNumber] = useState<number>(1);

  // Persistent player roster across rounds
  const [persistentBoard, setPersistentBoard] = useState<BoardState | null>(null);
  const [persistentBench, setPersistentBench] = useState<PositionedUnit[]>([]);

  const [initialBoards, setInitialBoards] = useState<{
    boardA: BoardState;
    boardB: BoardState;
  } | null>(null);

  // For dual board local mode (local side coordinates: x: 0..6, y: 0..3; melee frontline y=3, ranged backline y=0)
  const [dualBoardB, setDualBoardB] = useState<BoardState>(() => [
    createUnit('Knight', crypto.randomUUID(), 3, 3),
    createUnit('Archer', crypto.randomUUID(), 2, 0),
    createUnit('Archer', crypto.randomUUID(), 4, 0),
  ]);

  // Listen to Postgres changes on public:matches
  useEffect(() => {
    if (!activeMatchId || !supabase) return;

    try {
      const channel = supabase
        .channel('public:matches')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'matches',
            filter: `id=eq.${activeMatchId}`,
          },
          (payload) => {
            const updatedMatch = payload.new as MatchRow;

            if (updatedMatch.status === 'ready' && updatedMatch.board_b) {
              setMatchStatus('ready');
              setActiveSeed(updatedMatch.seed);
              setInitialBoards({
                boardA: updatedMatch.board_a,
                boardB: updatedMatch.board_b,
              });

              // Deterministic Lockstep Execution:
              // Both clients execute identical math locally from the shared payload
              const events = simulateCombat(
                updatedMatch.board_a,
                updatedMatch.board_b,
                updatedMatch.seed
              );
              setCombatLog(events);
            }
          }
        )
        .subscribe();

      return () => {
        if (supabase) {
          supabase.removeChannel(channel);
        }
      };
    } catch (err) {
      console.warn('Supabase subscription error:', err);
    }
  }, [activeMatchId]);

  const handleLockIn = async (myBoard: BoardState, myBench: PositionedUnit[]) => {
    setErrorMessage(null);
    setPersistentBoard(myBoard);
    setPersistentBench(myBench);

    // MODE 1: INSTANT OPPONENT MATCH (Deterministic local opponent)
    if (matchMode === 'instant') {
      setMatchStatus('waiting');

      setTimeout(() => {
        const opponentBoard = generateBotBoard(getBotLevelForRound(roundNumber));

        const seed = customSeedInput.trim() || crypto.randomUUID();
        setActiveSeed(seed);
        setInitialBoards({
          boardA: myBoard,
          boardB: opponentBoard,
        });

        const events = simulateCombat(myBoard, opponentBoard, seed);
        setCombatLog(events);
        setMatchStatus('ready');
      }, 350);
      return;
    }

    // MODE 2: DUAL BOARD SETUP
    if (matchMode === 'dual') {
      const seed = customSeedInput.trim() || crypto.randomUUID();
      setActiveSeed(seed);
      setInitialBoards({
        boardA: myBoard,
        boardB: dualBoardB,
      });
      const events = simulateCombat(myBoard, dualBoardB, seed);
      setCombatLog(events);
      setMatchStatus('ready');
      return;
    }

    // MODE 3: SUPABASE REALTIME MATCHMAKING
    if (!supabase || !isConfiguredSupabase) {
      setErrorMessage(
        'Supabase is not configured with live environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY). Switch to "Instant Match" or "Dual Board" to test simulation immediately, or configure Supabase.'
      );
      setMatchStatus('idle');
      return;
    }

    setMatchStatus('waiting');

    try {
      // 1. Search for an existing match waiting for an opponent
      const { data: openMatch, error: fetchError } = await supabase
        .from('matches')
        .select('*')
        .eq('status', 'waiting')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle<MatchRow>();

      if (fetchError) {
        console.error('Matchmaking query failed:', fetchError);
        setErrorMessage(`Matchmaking query failed: ${fetchError.message}`);
        setMatchStatus('idle');
        return;
      }

      // 2A. Found an open match -> Join as Player B and transition status to 'ready'
      if (openMatch) {
        setActiveMatchId(openMatch.id);

        const { data: updatedMatch, error: updateError } = await supabase
          .from('matches')
          .update({
            board_b: myBoard,
            status: 'ready',
          })
          .eq('id', openMatch.id)
          .select()
          .single<MatchRow>();

        if (updateError || !updatedMatch || !updatedMatch.board_b) {
          console.error('Failed to join match:', updateError);
          setErrorMessage(updateError ? updateError.message : 'Failed to join match');
          setMatchStatus('idle');
          return;
        }

        // Trigger simulation immediately for Player B as well
        setMatchStatus('ready');
        setActiveSeed(updatedMatch.seed);
        setInitialBoards({
          boardA: updatedMatch.board_a,
          boardB: updatedMatch.board_b,
        });

        const events = simulateCombat(
          updatedMatch.board_a,
          updatedMatch.board_b,
          updatedMatch.seed
        );
        setCombatLog(events);
        return;
      }

      // 2B. No open match found -> Create a new lobby as Player A
      const sharedSeed = customSeedInput.trim() || crypto.randomUUID();
      const { data: createdMatch, error: insertError } = await supabase
        .from('matches')
        .insert({
          status: 'waiting',
          board_a: myBoard,
          seed: sharedSeed,
        })
        .select()
        .single<MatchRow>();

      if (insertError || !createdMatch) {
        console.error('Failed to create match:', insertError);
        setErrorMessage(insertError ? insertError.message : 'Failed to create match');
        setMatchStatus('idle');
        return;
      }

      setActiveMatchId(createdMatch.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Unexpected Supabase error:', err);
      setErrorMessage(`Matchmaking network error: ${msg}`);
      setMatchStatus('idle');
    }
  };

  const handleRoundEnd = (winner: string, damage: number, survivors: number) => {
    let nextPlayerHp = playerHp;
    let nextEnemyHp = enemyHp;

    if (winner === 'TEAM_A') {
      nextEnemyHp = Math.max(0, enemyHp - damage);
      setEnemyHp(nextEnemyHp);
    } else if (winner === 'TEAM_B') {
      nextPlayerHp = Math.max(0, playerHp - damage);
      setPlayerHp(nextPlayerHp);
    } else {
      // DRAW: deduct 1 from both
      nextPlayerHp = Math.max(0, playerHp - 1);
      nextEnemyHp = Math.max(0, enemyHp - 1);
      setPlayerHp(nextPlayerHp);
      setEnemyHp(nextEnemyHp);
    }

    const result: 'win' | 'loss' | 'draw' =
      winner === 'TEAM_A' ? 'win' : winner === 'TEAM_B' ? 'loss' : 'draw';
    const nextStreak = updateStreak(streak, result);
    const streakBonus = getStreakBonusGold(nextStreak);
    setStreak(nextStreak);

    // Guarantee base 10 gold plus survivor bonus for Team A win plus streak bonus plus banked interest
    setGold((prev) => {
      const interest = getInterestGold(prev);
      return prev + 10 + (winner === 'TEAM_A' ? survivors : 0) + streakBonus + interest;
    });

    // Award automatic +2 XP per round
    const nextProgress = applyXpGain(level, xp, 2);
    setLevel(nextProgress.level);
    setXp(nextProgress.xp);

    setCombatLog(null);
    setInitialBoards(null);

    // End-Game Check: If player or enemy runs out of health, transition to game_over
    if (nextPlayerHp <= 0 || nextEnemyHp <= 0) {
      setMatchStatus('game_over');
    } else {
      // Advance round counter and return to draft shop for next round
      setRoundNumber((prev) => prev + 1);
      setMatchStatus('idle');
    }
  };

  const handleReset = () => {
    setMatchStatus('menu');
    setCombatLog(null);
    setInitialBoards(null);
    setActiveMatchId(null);
    setErrorMessage(null);
    setPlayerHp(30);
    setEnemyHp(30);
    setGold(12);
    setLevel(1);
    setXp(0);
    setStreak({ type: 'none', count: 0 });
    setRoundNumber(1);
    setPersistentBoard(null);
    setPersistentBench([]);
    setCustomSeedInput('match-' + Math.floor(Math.random() * 90000 + 10000));
  };

  const handleRestartNewRun = () => {
    setPlayerHp(30);
    setEnemyHp(30);
    setGold(12);
    setLevel(1);
    setXp(0);
    setStreak({ type: 'none', count: 0 });
    setRoundNumber(1);
    setPersistentBoard(null);
    setPersistentBench([]);
    setCombatLog(null);
    setInitialBoards(null);
    setMatchStatus('idle');
  };

  return (
    <div
      style={{
        maxWidth: '1280px',
        margin: '0 auto',
        padding: '12px',
        width: '100%',
        minHeight: '100vh',
        boxSizing: 'border-box',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <header style={{ marginBottom: '1.25rem', borderBottom: '1px solid #334155', paddingBottom: '0.85rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0, color: '#f8fafc' }}>
              Deterministic Auto-Battler MVP
            </h1>
            <p style={{ margin: '0.2rem 0 0 0', color: '#94a3b8', fontSize: '0.88rem' }}>
              Round {roundNumber} &bull; Synergies, Classes & Multi-Round Economy Loop &bull; 7x8 Arena
            </p>
          </div>

          {/* Back to Main Menu Button */}
          {matchStatus !== 'menu' && (
            <button
              type="button"
              onClick={handleReset}
              style={{
                padding: '0.45rem 0.9rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                backgroundColor: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #475569',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              ← Back to Main Menu
            </button>
          )}
        </div>

        {/* Deterministic Seed Controls */}
        {matchStatus !== 'ready' && matchStatus !== 'menu' && matchStatus !== 'game_over' && (
          <div
            style={{
              marginTop: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.85rem',
              flexWrap: 'wrap',
              backgroundColor: '#1e293b',
              padding: '0.55rem 0.9rem',
              borderRadius: '8px',
              border: '1px solid #334155',
            }}
          >
            <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Deterministic PRNG Seed:
              <input
                type="text"
                value={customSeedInput}
                onChange={(e) => setCustomSeedInput(e.target.value)}
                style={{
                  padding: '0.3rem 0.6rem',
                  fontSize: '0.82rem',
                  fontFamily: 'monospace',
                  borderRadius: '4px',
                  backgroundColor: '#0f172a',
                  color: '#f8fafc',
                  border: '1px solid #475569',
                  width: '190px',
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => setCustomSeedInput('seed-' + Math.random().toString(36).substring(2, 9))}
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                padding: '0.3rem 0.65rem',
                backgroundColor: '#334155',
                color: '#f8fafc',
                border: '1px solid #475569',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Randomize Seed
            </button>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              Identical seeds + squad layouts produce 100% reproducible combat tapes across any client.
            </span>
          </div>
        )}

        {errorMessage && (
          <div
            style={{
              marginTop: '0.85rem',
              padding: '0.75rem 1rem',
              backgroundColor: '#450a0a',
              border: '1px solid #dc2626',
              borderRadius: '6px',
              color: '#fecaca',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
            }}
          >
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={handleReset}
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                padding: '0.25rem 0.6rem',
                backgroundColor: '#b91c1c',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Return to Main Menu
            </button>
          </div>
        )}
      </header>

      {/* Main Menu View */}
      {matchStatus === 'menu' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2.75rem 1.5rem',
            backgroundColor: '#1e293b',
            borderRadius: '12px',
            border: '1px solid #334155',
            maxWidth: '560px',
            margin: '2rem auto',
            boxShadow: '0 8px 20px rgba(0, 0, 0, 0.35)',
          }}
        >
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f8fafc', marginBottom: '0.5rem', textAlign: 'center' }}>
            Select Game Mode
          </h2>
          <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '2rem', textAlign: 'center' }}>
            Draft your squad, trigger synergies (Human, Elf, Mage), and deplete enemy health!
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', width: '100%', maxWidth: '380px' }}>
            <button
              type="button"
              onClick={() => {
                setMatchMode('instant');
                setMatchStatus('idle');
              }}
              style={{
                padding: '1rem 1.5rem',
                fontSize: '1rem',
                fontWeight: 700,
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                boxShadow: '0 4px 10px rgba(37, 99, 235, 0.35)',
                transition: 'all 0.15s ease',
                textAlign: 'center',
              }}
            >
              Play Draft Match (Multi-Round Auto-Battler)
            </button>

            <button
              type="button"
              onClick={() => {
                setMatchMode('dual');
                setMatchStatus('idle');
              }}
              style={{
                padding: '1rem 1.5rem',
                fontSize: '1rem',
                fontWeight: 700,
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                boxShadow: '0 4px 10px rgba(37, 99, 235, 0.35)',
                transition: 'all 0.15s ease',
                textAlign: 'center',
              }}
            >
              Dual Squad Sandbox
            </button>

            <button
              type="button"
              onClick={() => alert('Multiplayer matchmaking connects live via Supabase Realtime!')}
              style={{
                padding: '1rem 1.5rem',
                fontSize: '1rem',
                fontWeight: 700,
                backgroundColor: '#334155',
                color: '#f8fafc',
                border: '1px solid #475569',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                textAlign: 'center',
              }}
            >
              Multiplayer Matchmaking (Supabase)
            </button>
          </div>
        </div>
      )}

      {/* Game Over Screen */}
      {matchStatus === 'game_over' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2.75rem 2rem',
            backgroundColor: '#1e293b',
            borderRadius: '16px',
            border: playerHp > 0 ? '2px solid #22c55e' : '2px solid #ef4444',
            maxWidth: '520px',
            margin: '2rem auto',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.45)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '3.5rem', marginBottom: '0.5rem' }}>
            {playerHp > 0 ? '👑' : enemyHp <= 0 ? '🤝' : '💀'}
          </div>

          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0, color: playerHp > 0 ? '#4ade80' : '#f87171' }}>
            {playerHp > 0 ? 'Victory!' : enemyHp <= 0 ? 'Mutual Knockout (Draw)!' : 'Defeat!'}
          </h2>

          <p style={{ fontSize: '0.95rem', color: '#94a3b8', marginTop: '0.5rem', marginBottom: '1.5rem' }}>
            {playerHp > 0
              ? `You eliminated the enemy in ${roundNumber} round${roundNumber === 1 ? '' : 's'}!`
              : 'Your health dropped to 0. Upgrade synergies and stats in your next attempt!'}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '1rem',
              width: '100%',
              backgroundColor: '#0f172a',
              padding: '1rem',
              borderRadius: '10px',
              border: '1px solid #334155',
              marginBottom: '1.75rem',
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Final Player HP</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: playerHp > 0 ? '#4ade80' : '#f87171' }}>
                {playerHp}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Final Enemy HP</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: enemyHp <= 0 ? '#f87171' : '#c084fc' }}>
                {enemyHp}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Gold Remaining</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fbbf24' }}>
                {gold}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', width: '100%' }}>
            <button
              type="button"
              onClick={handleRestartNewRun}
              style={{
                flex: 1,
                padding: '0.85rem 1.25rem',
                fontSize: '0.95rem',
                fontWeight: 700,
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              Play Again ↺
            </button>
            <button
              type="button"
              onClick={handleReset}
              style={{
                flex: 1,
                padding: '0.85rem 1.25rem',
                fontSize: '0.95rem',
                fontWeight: 600,
                backgroundColor: '#334155',
                color: '#f8fafc',
                border: '1px solid #475569',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              Main Menu
            </button>
          </div>
        </div>
      )}

      {/* Battlefield & Drafting View */}
      {matchStatus !== 'ready' && matchStatus !== 'menu' && matchStatus !== 'game_over' && (
        <div>
          {matchMode === 'dual' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#38bdf8', margin: '0 0 8px 0' }}>
                  Team A (Player 1)
                </h3>
                <BoardBuilder
                  onLockIn={(newBoard) => handleLockIn(newBoard, [])}
                  disabled={matchStatus === 'waiting'}
                  lockInButtonLabel="Start Battle Simulation"
                  gold={gold}
                  setGold={setGold}
                  playerHp={playerHp}
                  enemyHp={enemyHp}
                />
              </div>

              <div style={{ borderTop: '1px solid #334155', paddingTop: '1.25rem' }}>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#c084fc', margin: '0 0 8px 0' }}>
                  Team B (Player 2)
                </h3>
                <BoardBuilder
                  initialBoard={dualBoardB}
                  onLockIn={(newBoardB) => setDualBoardB(newBoardB)}
                  disabled={matchStatus === 'waiting'}
                  title="Design Team B (Opponent Squad)"
                  lockInButtonLabel="Update Team B Roster"
                  gold={gold}
                  setGold={setGold}
                  playerHp={playerHp}
                  enemyHp={enemyHp}
                />
              </div>
            </div>
          ) : (
            <BoardBuilder
              mode="draft"
              initialBoard={persistentBoard ?? undefined}
              initialBench={persistentBench}
              onLockIn={handleLockIn}
              disabled={matchStatus === 'waiting'}
              gold={gold}
              setGold={setGold}
              level={level}
              setLevel={setLevel}
              xp={xp}
              setXp={setXp}
              streak={streak}
              playerHp={playerHp}
              enemyHp={enemyHp}
              lockInButtonLabel={
                matchMode === 'instant'
                  ? `Lock In & Fight Round ${roundNumber}`
                  : 'Lock In / Search for Match'
              }
            />
          )}
        </div>
      )}

      {/* Combat Playback View */}
      {matchStatus === 'ready' && combatLog && initialBoards && (
        <CombatVisualizer
          events={combatLog}
          initialBoardA={initialBoards.boardA}
          initialBoardB={initialBoards.boardB}
          seed={activeSeed}
          playerHp={matchMode === 'instant' ? playerHp : undefined}
          onRoundEnd={handleRoundEnd}
        />
      )}
    </div>
  );
};
