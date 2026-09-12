import { SUITS, invariant, type RandomSource, type Suit } from '../core/index.js';

export const HILO_RANKS = 13;

/** Carte du Hi-Lo : rang 1 (As, la plus basse) à 13 (Roi, la plus haute). */
export interface HiloCard {
  readonly rank: number;
  readonly suit: Suit;
}

export type HiloDirection = 'HIGHER' | 'LOWER';

export const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'] as const;

export function rankLabel(rank: number): string {
  return RANK_LABELS[rank - 1] ?? '?';
}

/**
 * Sabot infini : chaque carte est tirée indépendamment (enseigne puis rang), les probabilités ne dépendent donc que
 * de la carte visible. Consomme exactement deux tirages.
 */
export function drawHiloCard(rng: RandomSource): HiloCard {
  const suit = SUITS[rng.nextInt(SUITS.length)];
  invariant(suit !== undefined, 'Enseigne introuvable');
  return { rank: 1 + rng.nextInt(HILO_RANKS), suit };
}

/** « Plus haut ou égal » gagne si la carte suivante est de rang ≥ ; « Plus bas ou égal » si elle est de rang ≤. */
export function winChance(rank: number, direction: HiloDirection): number {
  return direction === 'HIGHER' ? (HILO_RANKS + 1 - rank) / HILO_RANKS : rank / HILO_RANKS;
}

/** Un pari gagné d'avance (plus haut sur un As, plus bas sur un Roi) n'est pas proposé. */
export function isGuessAllowed(rank: number, direction: HiloDirection): boolean {
  return winChance(rank, direction) < 1;
}

/** Cote en centièmes : (1 − marge) / chance, arrondie à l'inférieur. */
export function stepMultiplier(rank: number, direction: HiloDirection, houseEdge: number): number {
  return Math.floor(((1 - houseEdge) / winChance(rank, direction)) * 100 + 1e-9);
}

export function isWinningGuess(current: HiloCard, next: HiloCard, direction: HiloDirection): boolean {
  return direction === 'HIGHER' ? next.rank >= current.rank : next.rank <= current.rank;
}

/** 183 → "1,83". */
export function formatHiloMultiplier(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}
