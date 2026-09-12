/** Soldes et bilan des jetons gagnés / perdus, conservés dans le navigateur d'une session à l'autre. */

export type GameKey = 'blackjack' | 'holdem' | 'roulette' | 'grattage' | 'courses' | 'plinko' | 'mines' | 'hilo' | 'pachinko';

export interface GameStats {
  /** Somme des gains nets des manches gagnantes. */
  readonly won: number;
  /** Somme (positive) des pertes nettes des manches perdantes. */
  readonly lost: number;
  readonly rounds: number;
}

export type Ledger = Readonly<Record<GameKey, GameStats>>;

/** Solde de départ, à la première visite d'un jeu. */
export const DEFAULT_BALANCE = 1_000;

const LEDGER_KEY = 'casino-engine:ledger:v1';
const BALANCE_KEY = 'casino-engine:balance:v1';
const GAMES: readonly GameKey[] = ['blackjack', 'holdem', 'roulette', 'grattage', 'courses', 'plinko', 'mines', 'hilo', 'pachinko'];
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
  return {
    blackjack: parseStats(data['blackjack']),
    holdem: parseStats(data['holdem']),
    roulette: parseStats(data['roulette']),
    grattage: parseStats(data['grattage']),
    courses: parseStats(data['courses']),
    plinko: parseStats(data['plinko']),
    mines: parseStats(data['mines']),
    hilo: parseStats(data['hilo']),
    pachinko: parseStats(data['pachinko']),
  };
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

/** Solde avec lequel s'asseoir : le solde sauvegardé, même nul, ou DEFAULT_BALANCE à la première visite. */
export function startingBalance(game: GameKey, _minimum?: number): number {
  return loadBalance(game) ?? DEFAULT_BALANCE;
}

/** Jetons récupérables une fois par jour dans chaque jeu, quand le solde ne permet plus de jouer. */
export const DAILY_REFILL = 1_000;

/** Jour local (AAAA-MM-JJ) de la dernière recharge prise, par jeu. */
const REFILL_KEY = 'casino-engine:daily-refill:v1';

/** La recharge revient à minuit, heure locale du joueur. */
function todayStamp(now = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function canClaimDailyRefill(game: GameKey): boolean {
  return readJson(REFILL_KEY)[game] !== todayStamp();
}

/** Consomme la recharge du jour pour ce jeu ; false si elle a déjà été prise aujourd'hui. */
export function claimDailyRefill(game: GameKey): boolean {
  if (!canClaimDailyRefill(game)) return false;
  writeJson(REFILL_KEY, { ...readJson(REFILL_KEY), [game]: todayStamp() });
  return true;
}

/** Remet à zéro le bilan et ramène les soldes au solde de départ. */
export function resetLedger(): Ledger {
  const empty: Ledger = {
    blackjack: EMPTY,
    holdem: EMPTY,
    roulette: EMPTY,
    grattage: EMPTY,
    courses: EMPTY,
    plinko: EMPTY,
    mines: EMPTY,
    hilo: EMPTY,
    pachinko: EMPTY,
  };
  writeJson(LEDGER_KEY, empty);
  writeJson(BALANCE_KEY, {});
  return empty;
}
