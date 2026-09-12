/** Soldes et bilan des jetons gagnés / perdus, conservés dans le navigateur d'une session à l'autre. */

export type GameKey = 'blackjack' | 'holdem' | 'roulette';

export interface GameStats {
  /** Somme des gains nets des manches gagnantes. */
  readonly won: number;
  /** Somme (positive) des pertes nettes des manches perdantes. */
  readonly lost: number;
  readonly rounds: number;
}

export type Ledger = Readonly<Record<GameKey, GameStats>>;

/** Solde de départ, et de recave quand le solde sauvegardé ne permet plus de jouer. */
export const DEFAULT_BALANCE = 1_000;

const LEDGER_KEY = 'casino-engine:ledger:v1';
const BALANCE_KEY = 'casino-engine:balance:v1';
const GAMES: readonly GameKey[] = ['blackjack', 'holdem', 'roulette'];
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

/** Le stockage peut être indisponible (navigation privée, cookies bloqués) ou corrompu : on retombe sur `{}`. */
function readJson(key: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Stockage indisponible : les données restent valables pour la page en cours.
  }
}

function parseStats(value: unknown): GameStats {
  if (typeof value !== 'object' || value === null) return EMPTY;
  const { won, lost, rounds } = value as Record<string, unknown>;
  return isCount(won) && isCount(lost) && isCount(rounds) ? { won, lost, rounds } : EMPTY;
}

export function loadLedger(): Ledger {
  const data = readJson(LEDGER_KEY);
  return { blackjack: parseStats(data['blackjack']), holdem: parseStats(data['holdem']), roulette: parseStats(data['roulette']) };
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
  writeJson(LEDGER_KEY, next);
  return next;
}

/** Solde sauvegardé du jeu, ou null s'il n'a jamais été joué. */
export function loadBalance(game: GameKey): number | null {
  const value = readJson(BALANCE_KEY)[game];
  return isCount(value) ? value : null;
}

export function saveBalance(game: GameKey, amount: number): void {
  writeJson(BALANCE_KEY, { ...readJson(BALANCE_KEY), [game]: amount });
}

/** Solde avec lequel s'asseoir : le solde sauvegardé s'il atteint `minimum`, sinon une recave de DEFAULT_BALANCE. */
export function startingBalance(game: GameKey, minimum = 1): number {
  const saved = loadBalance(game);
  return saved !== null && saved >= minimum ? saved : DEFAULT_BALANCE;
}

/** Remet à zéro le bilan et ramène les soldes au solde de départ. */
export function resetLedger(): Ledger {
  const empty: Ledger = { blackjack: EMPTY, holdem: EMPTY, roulette: EMPTY };
  writeJson(LEDGER_KEY, empty);
  writeJson(BALANCE_KEY, {});
  return empty;
}
