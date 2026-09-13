/** Soldes et bilan des jetons gagnés / perdus, conservés dans le navigateur d'une session à l'autre. */

export type GameKey = 'blackjack' | 'holdem' | 'roulette' | 'grattage' | 'courses' | 'plinko' | 'mines' | 'hilo' | 'pachinko';

/** Montants en bigint : la Roulette sans limite dépasse les entiers sûrs, et le bilan doit rester exact. */
export interface GameStats {
  /** Somme des gains nets des manches gagnantes. */
  readonly won: bigint;
  /** Somme (positive) des pertes nettes des manches perdantes. */
  readonly lost: bigint;
  readonly rounds: number;
}

export type Ledger = Readonly<Record<GameKey, GameStats>>;

/** Solde de départ, à la première visite d'un jeu. */
export const DEFAULT_BALANCE = 1_000;

const LEDGER_KEY = 'casino-engine:ledger:v1';
const BALANCE_KEY = 'casino-engine:balance:v1';
const GAMES: readonly GameKey[] = ['blackjack', 'holdem', 'roulette', 'grattage', 'courses', 'plinko', 'mines', 'hilo', 'pachinko'];
const EMPTY: GameStats = { won: 0n, lost: 0n, rounds: 0 };
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);

export const netOf = (stats: GameStats): bigint => stats.won - stats.lost;

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

/** Montant relu du stockage : entier JSON (format historique) ou chaîne décimale (au-delà des entiers sûrs). */
function parseAmount(value: unknown): bigint | null {
  if (isCount(value)) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

/** Nombre JSON tant qu'il reste exact, chaîne décimale au-delà : JSON.stringify refuse les bigint. */
function storedAmount(value: bigint): number | string {
  return value <= SAFE_MAX ? Number(value) : value.toString();
}

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
  const wonAmount = parseAmount(won);
  const lostAmount = parseAmount(lost);
  return wonAmount !== null && lostAmount !== null && isCount(rounds) ? { won: wonAmount, lost: lostAmount, rounds } : EMPTY;
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

function writeLedger(ledger: Ledger): void {
  const stored = GAMES.map((game) => {
    const { won, lost, rounds } = ledger[game];
    return [game, { won: storedAmount(won), lost: storedAmount(lost), rounds }] as const;
  });
  writeJson(LEDGER_KEY, Object.fromEntries(stored));
}

/** Enregistre le résultat net (positif = gain, négatif = perte) d'une manche terminée. */
export function recordResult(game: GameKey, net: number | bigint): Ledger {
  const delta = BigInt(net);
  const ledger = loadLedger();
  const stats = ledger[game];
  const next: Ledger = {
    ...ledger,
    [game]: {
      won: stats.won + (delta > 0n ? delta : 0n),
      lost: stats.lost + (delta < 0n ? -delta : 0n),
      rounds: stats.rounds + 1,
    },
  };
  writeLedger(next);
  return next;
}

/** Solde sauvegardé du jeu, en précision arbitraire, ou null s'il n'a jamais été joué. */
export function loadBigBalance(game: GameKey): bigint | null {
  return parseAmount(readJson(BALANCE_KEY)[game]);
}

/** Solde sauvegardé d'un jeu à entiers sûrs (plafonné à Number.MAX_SAFE_INTEGER), ou null s'il n'a jamais été joué. */
export function loadBalance(game: GameKey): number | null {
  const value = loadBigBalance(game);
  return value === null ? null : Number(value < SAFE_MAX ? value : SAFE_MAX);
}

export function saveBalance(game: GameKey, amount: number | bigint): void {
  writeJson(BALANCE_KEY, { ...readJson(BALANCE_KEY), [game]: storedAmount(BigInt(amount)) });
}

/** Solde avec lequel s'asseoir : le solde sauvegardé, même nul, ou DEFAULT_BALANCE à la première visite. */
export function startingBalance(game: GameKey): number {
  return loadBalance(game) ?? DEFAULT_BALANCE;
}

/** Variante sans limite de startingBalance, pour la Roulette et l'affichage du lobby. */
export function startingBigBalance(game: GameKey): bigint {
  return loadBigBalance(game) ?? BigInt(DEFAULT_BALANCE);
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
