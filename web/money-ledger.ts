/** Bilan des jetons gagnés / perdus, conservé dans le navigateur d'une session à l'autre. */

export type GameKey = 'blackjack' | 'holdem';

export interface GameStats {
  /** Somme des gains nets des manches gagnantes. */
  readonly won: number;
  /** Somme (positive) des pertes nettes des manches perdantes. */
  readonly lost: number;
  readonly rounds: number;
}

export type Ledger = Readonly<Record<GameKey, GameStats>>;

const STORAGE_KEY = 'casino-engine:ledger:v1';
const GAMES: readonly GameKey[] = ['blackjack', 'holdem'];
const EMPTY: GameStats = { won: 0, lost: 0, rounds: 0 };

export const netOf = (stats: GameStats): number => stats.won - stats.lost;

export function totalOf(ledger: Ledger): GameStats {
  return GAMES.reduce<GameStats>(
    (sum, game) => ({
      won: sum.won + ledger[game].won,
      lost: sum.lost + ledger[game].lost,
      rounds: sum.rounds + ledger[game].rounds,
    }),
    EMPTY,
  );
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function parseStats(value: unknown): GameStats {
  if (typeof value !== 'object' || value === null) return EMPTY;
  const { won, lost, rounds } = value as Record<string, unknown>;
  return isCount(won) && isCount(lost) && isCount(rounds) ? { won, lost, rounds } : EMPTY;
}

/** Le stockage peut être indisponible (navigation privée, cookies bloqués) : on retombe sur un bilan vide. */
export function loadLedger(): Ledger {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    const data = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    return { blackjack: parseStats(data['blackjack']), holdem: parseStats(data['holdem']) };
  } catch {
    return { blackjack: EMPTY, holdem: EMPTY };
  }
}

function saveLedger(ledger: Ledger): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  } catch {
    // Stockage indisponible : le bilan reste valable pour la page en cours.
  }
}

/** Enregistre le résultat net (positif = gain, négatif = perte) d'une manche terminée. */
export function recordResult(game: GameKey, net: number): Ledger {
  const ledger = loadLedger();
  const stats = ledger[game];
  const next: Ledger = {
    ...ledger,
    [game]: {
      won: stats.won + Math.max(net, 0),
      lost: stats.lost + Math.max(-net, 0),
      rounds: stats.rounds + 1,
    },
  };
  saveLedger(next);
  return next;
}

export function resetLedger(): Ledger {
  const empty: Ledger = { blackjack: EMPTY, holdem: EMPTY };
  saveLedger(empty);
  return empty;
}
