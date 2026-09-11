import type { Card, Rank } from '../../core/index.js';

/** Ordre croissant de force. La quinte flush royale est une STRAIGHT_FLUSH à l'As (pas une catégorie à part). */
export const HAND_CATEGORIES = [
  'HIGH_CARD',
  'ONE_PAIR',
  'TWO_PAIR',
  'THREE_OF_A_KIND',
  'STRAIGHT',
  'FLUSH',
  'FULL_HOUSE',
  'FOUR_OF_A_KIND',
  'STRAIGHT_FLUSH',
] as const;

export type HandCategory = (typeof HAND_CATEGORIES)[number];

export type HoleCards = readonly [Card, Card];
export type FiveCards = readonly [Card, Card, Card, Card, Card];

export interface EvaluatedHand {
  readonly category: HandCategory;
  /**
   * Rangs décisifs, dans l'ordre exact de comparaison (kickers inclus) :
   *   Full KKK99 → [K, 9] · Deux paires QQ 44 A → [Q, 4, A] · Paire 88 A Q 5 → [8, A, Q, 5]
   *   Quinte « roue » A-2-3-4-5 → [5] (l'As y compte comme 1).
   */
  readonly tiebreakers: readonly Rank[];
  /** Les 5 meilleures cartes parmi les 7, pour l'affichage au showdown. */
  readonly bestFive: FiveCards;
  /** Entier totalement ordonné (catégorie puis tiebreakers) : comparer deux mains = comparer deux nombres. */
  readonly score: number;
}

export type Comparison = -1 | 0 | 1;

/** Contrat du Hand Ranker, implémenté à l'Étape 3. */
export interface HandEvaluator {
  /** Accepte 5 à 7 cartes distinctes. */
  evaluate(cards: readonly Card[]): EvaluatedHand;
  compare(a: EvaluatedHand, b: EvaluatedHand): Comparison;
}
