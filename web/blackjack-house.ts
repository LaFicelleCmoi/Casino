import { chips, type Card } from '../src/core/index.js';
import type { BlackjackRules, DoubleRestriction, SurrenderRule } from '../src/blackjack/index.js';

/**
 * Règles de la maison fixées par le croupier humain, et leurs conséquences sur la table : avantage de la maison,
 * affluence, taille des mises, pourboires. Tout est pur ici : la table tire au sort, ce module ne fait que chiffrer.
 */

export type BlackjackPayout = '3:2' | '6:5' | '1:1';
export type Soft17 = 'STAND' | 'HIT';
export type DeckCount = 1 | 2 | 6 | 8;
export type TableMinimum = 10 | 25 | 100;
export type TableMaximum = 500 | 1000 | 5000;
export type ServiceLength = 10 | 20 | 30;

export interface HouseRules {
  readonly payout: BlackjackPayout;
  readonly soft17: Soft17;
  readonly decks: DeckCount;
  readonly double: DoubleRestriction;
  readonly doubleAfterSplit: boolean;
  readonly surrender: SurrenderRule;
  readonly minBet: TableMinimum;
  readonly maxBet: TableMaximum;
  /** Pari annexe « Paires parfaites » sur les deux premières cartes de la première main. */
  readonly perfectPairs: boolean;
  /** Nombre de manches d'un service, au bout duquel tombe la note. */
  readonly serviceLength: ServiceLength;
}

/** Les règles standard de la table : 3:2, soft 17 reste, 6 jeux, double partout et après split, sans abandon. */
export const DEFAULT_HOUSE: HouseRules = Object.freeze({
  payout: '3:2',
  soft17: 'STAND',
  decks: 6,
  double: 'ANY_TWO',
  doubleAfterSplit: true,
  surrender: 'NONE',
  minBet: 10,
  maxBet: 1000,
  perfectPairs: false,
  serviceLength: 20,
});

/** Choix proposés au croupier, dans l'ordre d'affichage, du plus généreux au plus serré quand ça a un sens. */
export const HOUSE_CHOICES = {
  payout: ['3:2', '6:5', '1:1'],
  soft17: ['STAND', 'HIT'],
  decks: [1, 2, 6, 8],
  double: ['ANY_TWO', 'NINE_TO_ELEVEN', 'TEN_OR_ELEVEN'],
  doubleAfterSplit: [true, false],
  surrender: ['LATE', 'NONE'],
  minBet: [10, 25, 100],
  maxBet: [500, 1000, 5000],
  perfectPairs: [false, true],
  serviceLength: [10, 20, 30],
} as const satisfies { readonly [K in keyof HouseRules]: readonly HouseRules[K][] };

const PAYOUT_RATIO: Record<BlackjackPayout, { numerator: number; denominator: number }> = {
  '3:2': { numerator: 3, denominator: 2 },
  '6:5': { numerator: 6, denominator: 5 },
  '1:1': { numerator: 1, denominator: 1 },
};

/** Règles venues du réseau : chaque champ doit être l'un des choix proposés, sinon tout est refusé. */
export function parseHouseRules(raw: unknown): HouseRules | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const parsed: Record<string, unknown> = {};
  for (const key of Object.keys(HOUSE_CHOICES) as (keyof HouseRules)[]) {
    const value = record[key];
    if (!(HOUSE_CHOICES[key] as readonly unknown[]).includes(value)) return null;
    parsed[key] = value;
  }
  if ((parsed['maxBet'] as number) < (parsed['minBet'] as number) * 10) return null;
  return parsed as unknown as HouseRules;
}

/** Applique les règles de la maison aux règles du moteur (le reste de la table ne change pas). */
export function applyHouseRules(rules: BlackjackRules, house: HouseRules): BlackjackRules {
  return {
    ...rules,
    blackjackPayout: PAYOUT_RATIO[house.payout],
    dealerHitsSoft17: house.soft17 === 'HIT',
    deckCount: house.decks,
    doubleRestriction: house.double,
    doubleAfterSplit: house.doubleAfterSplit,
    surrender: house.surrender,
    minBet: chips(house.minBet),
    maxBet: chips(house.maxBet),
  };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Avantage de la maison des règles standard, en %, face à un joueur en stratégie de base. */
export const BASE_EDGE = 0.4;

/** Avantage de la maison sur les Paires parfaites (25:1 · 12:1 · 6:1), en %. */
export const PERFECT_PAIRS_EDGE = 4.1;

/** Paiements des Paires parfaites, hors mise rendue. */
export const PERFECT_PAIRS_PAYOUTS = { PERFECT: 25, COLORED: 12, MIXED: 6 } as const;
export type PerfectPair = keyof typeof PERFECT_PAIRS_PAYOUTS;

/**
 * Avantage de la maison en % (négatif : les joueurs ont l'avantage), d'après les écarts usuels de chaque règle
 * par rapport au standard. Une approximation suffit : c'est elle qui guide les joueurs, pas une simulation.
 */
export function houseEdge(house: HouseRules): number {
  let edge = BASE_EDGE;
  edge += { '3:2': 0, '6:5': 1.39, '1:1': 2.27 }[house.payout];
  if (house.soft17 === 'HIT') edge += 0.22;
  edge += { 1: -0.48, 2: -0.19, 6: 0, 8: 0.02 }[house.decks];
  edge += { ANY_TWO: 0, NINE_TO_ELEVEN: 0.09, TEN_OR_ELEVEN: 0.18 }[house.double];
  if (!house.doubleAfterSplit) edge += 0.14;
  if (house.surrender === 'LATE') edge -= 0.08;
  return round2(edge);
}

/** Paliers d'une mise « Paires parfaites » : rien, le minimum, le double, cinq fois le minimum. */
export const sideBetSteps = (house: HouseRules): readonly number[] => [0, house.minBet, house.minBet * 2, house.minBet * 5];

/** Pourboire qu'un invité laisse d'un clic : la moitié du minimum de table. */
export const guestTip = (house: HouseRules): number => Math.max(1, Math.round(house.minBet / 2));

/** Deux premières cartes d'une main : même rang et même couleur, même teinte, ou simple paire. */
export function perfectPair(first: Card, second: Card): PerfectPair | null {
  if (first.rank !== second.rank) return null;
  if (first.suit === second.suit) return 'PERFECT';
  const red = (card: Card): boolean => card.suit === 'hearts' || card.suit === 'diamonds';
  return red(first) === red(second) ? 'COLORED' : 'MIXED';
}

// ─── Comportement des joueurs face aux règles ──────────────────────────────

const MINIMUM_APPEAL: Record<TableMinimum, number> = { 10: 1, 25: 0.9, 100: 0.75 };

/** Chance, à chaque manche, qu'une place libre trouve preneur : les tables serrées et chères attirent moins. */
export function arrivalChance(house: HouseRules): number {
  return clamp(0.9 - 0.25 * (houseEdge(house) - BASE_EDGE), 0.1, 0.95) * MINIMUM_APPEAL[house.minBet];
}

/** Chance qu'un joueur quitte la table après une manche ; un croupier lent fait fuir un peu plus. */
export function departureChance(house: HouseRules, slow: boolean): number {
  return clamp(0.02 + 0.12 * (houseEdge(house) - BASE_EDGE), 0.01, 0.5) + (slow ? 0.08 : 0);
}

/** Appétit de mise : au-dessus de 1 les joueurs visent gros, en dessous ils se contentent des petites mises. */
export function betAppetite(house: HouseRules): number {
  return clamp(1 - 0.3 * (houseEdge(house) - BASE_EDGE), 0.35, 1.5);
}

/** Chance qu'un joueur gagnant laisse un pourboire : une maison radine n'en reçoit presque plus. */
export function tipChance(house: HouseRules): number {
  return clamp(0.35 - 0.1 * (houseEdge(house) - BASE_EDGE), 0.05, 0.45);
}

/** Un croupier vif (≤ 1,5 s par geste) reçoit plus de pourboires, un lent (≥ 4 s) beaucoup moins. */
export function speedFactor(averageMs: number | null): number {
  if (averageMs === null) return 1;
  return clamp(1.3 - (0.7 * (averageMs - 1500)) / 2500, 0.6, 1.3);
}

/** Délai moyen au-delà duquel les joueurs trouvent le croupier lent. */
export const SLOW_GESTURE_MS = 4000;

/** Pourboire d'un gagnant : 5 % de sa mise, au moins 1 jeton, doublé sur un Blackjack. */
export const tipAmount = (stake: number, blackjack: boolean): number => Math.max(1, Math.round(stake * 0.05)) * (blackjack ? 2 : 1);

export type HouseMood = 'GENEROUS' | 'BALANCED' | 'TIGHT' | 'STINGY';

export function houseMood(house: HouseRules): HouseMood {
  const edge = houseEdge(house);
  if (edge < 0.3) return 'GENEROUS';
  if (edge < 0.8) return 'BALANCED';
  if (edge < 1.6) return 'TIGHT';
  return 'STINGY';
}

// ─── Note de service ───────────────────────────────────────────────────────

export interface ServiceStats {
  readonly rounds: number;
  /** Variation de la banque (manches, assurances et Paires parfaites). */
  readonly bankNet: number;
  readonly tips: number;
  /** Mises initiales et Paires parfaites engagées pendant le service. */
  readonly wagered: number;
  /** Gain théorique : chaque mise multipliée par l'avantage de la maison au moment de la donne. */
  readonly theo: number;
  /** Places occupées, additionnées à chaque donne, et nombre de donnes. */
  readonly seatsFilled: number;
  readonly deals: number;
  readonly gestures: number;
  readonly gestureMs: number;
}

export const EMPTY_SERVICE: ServiceStats = Object.freeze({
  rounds: 0,
  bankNet: 0,
  tips: 0,
  wagered: 0,
  theo: 0,
  seatsFilled: 0,
  deals: 0,
  gestures: 0,
  gestureMs: 0,
});

export type ServiceGrade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface ServiceNote {
  /** Note sur 100 : moyenne des quatre critères. */
  readonly score: number;
  readonly grade: ServiceGrade;
  readonly parts: readonly { readonly label: string; readonly detail: string; readonly points: number }[];
}

/**
 * Objectifs par manche, en fraction du minimum de table : 0,8 minimum de pourboires et 0,5 minimum de gain théorique.
 * Ni une table radine (pas de pourboires) ni une table trop généreuse (gain théorique nul) ne peut viser le S.
 */
const TIPS_TARGET = 0.8;
const THEO_TARGET = 0.5;

const GRADES: readonly [number, ServiceGrade][] = [
  [90, 'S'],
  [78, 'A'],
  [64, 'B'],
  [50, 'C'],
];

export const gradeOf = (score: number): ServiceGrade => GRADES.find(([threshold]) => score >= threshold)?.[1] ?? 'D';

/**
 * Note de fin de service : rapidité des gestes, affluence, pourboires et gain théorique. Le résultat réel de la
 * banque n'y entre pas — c'est la chance — mais le gain théorique récompense les bonnes règles et le volume de jeu.
 */
export function serviceNote(stats: ServiceStats, minBet: number, seatCount: number): ServiceNote {
  const rounds = Math.max(1, stats.rounds);
  const average = stats.gestures === 0 ? null : stats.gestureMs / stats.gestures;
  const speed = average === null ? 50 : clamp(((5000 - average) / 4000) * 100, 0, 100);
  const crowd = stats.deals === 0 ? 0 : clamp((stats.seatsFilled / (stats.deals * seatCount)) * 100, 0, 100);
  const tips = clamp((stats.tips / (rounds * minBet * TIPS_TARGET)) * 100, 0, 100);
  const theo = clamp((stats.theo / (rounds * minBet * THEO_TARGET)) * 100, 0, 100);
  const parts = [
    { label: 'Rapidité', detail: average === null ? 'aucun geste' : `${(average / 1000).toFixed(1).replace('.', ',')} s par geste`, points: speed },
    { label: 'Affluence', detail: `${Math.round(crowd)} % des places occupées`, points: crowd },
    { label: 'Pourboires', detail: `${stats.tips} jetons`, points: tips },
    { label: 'Gain théorique', detail: `${Math.round(stats.theo)} jetons`, points: theo },
  ].map((part) => ({ ...part, points: Math.round(part.points) }));
  const score = Math.round(parts.reduce((total, part) => total + part.points, 0) / parts.length);
  return { score, grade: gradeOf(score), parts };
}
