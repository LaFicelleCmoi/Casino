import { RANKS, cardCode, invariant, rankIndex, type Card, type Rank, type Suit } from '../../core/index.js';
import {
  HAND_CATEGORIES,
  type Comparison,
  type EvaluatedHand,
  type FiveCards,
  type HandCategory,
  type HandEvaluator,
} from '../types/hand-rank.js';

const byRankDesc = (a: Card, b: Card): number => rankIndex(b.rank) - rankIndex(a.rank);

/** Rang de la première carte d'un groupe non vide. */
const topRank = (cards: readonly Card[]): Rank => (cards[0] as Card).rank;

function toFive(cards: readonly Card[]): FiveCards {
  const [a, b, c, d, e] = cards;
  invariant(
    cards.length === 5 && a !== undefined && b !== undefined && c !== undefined && d !== undefined && e !== undefined,
    `Une main doit compter exactement 5 cartes (${cards.length} reçues)`,
  );
  return [a, b, c, d, e];
}

/**
 * Score entier totalement ordonné : catégorie puis 5 tiebreakers, en base 13.
 * Deux mains de même catégorie ont toujours le même nombre de tiebreakers, le bourrage à 0 est donc neutre.
 */
function encodeScore(category: HandCategory, tiebreakers: readonly Rank[]): number {
  let score = HAND_CATEGORIES.indexOf(category);
  for (let i = 0; i < 5; i += 1) {
    const rank = tiebreakers[i];
    score = score * RANKS.length + (rank === undefined ? 0 : rankIndex(rank));
  }
  return score;
}

function made(category: HandCategory, tiebreakers: readonly Rank[], bestFive: readonly Card[]): EvaluatedHand {
  return { category, tiebreakers, bestFive: toFive(bestFive), score: encodeScore(category, tiebreakers) };
}

/** Meilleure quinte : 5 cartes de la plus haute à la plus basse, ou null. La roue A-2-3-4-5 est la plus faible. */
function findStraight(cards: readonly Card[]): Card[] | null {
  const byRank = new Map<number, Card>();
  for (const card of cards) {
    const index = rankIndex(card.rank);
    if (!byRank.has(index)) byRank.set(index, card);
  }
  const ACE = RANKS.length - 1;
  for (let high = ACE; high >= 3; high -= 1) {
    const run: Card[] = [];
    for (let offset = 0; offset < 5; offset += 1) {
      const index = high - offset;
      const card = byRank.get(index < 0 ? ACE : index);
      if (card === undefined) break;
      run.push(card);
    }
    if (run.length === 5) return run;
  }
  return null;
}

/**
 * Évalue directement la meilleure main de 5 cartes parmi 5 à 7, sans énumérer les 21 combinaisons :
 * regroupement par rang et par couleur, puis test des catégories de la plus forte à la plus faible.
 */
export function evaluateHand(cards: readonly Card[]): EvaluatedHand {
  invariant(cards.length >= 5 && cards.length <= 7, `5 à 7 cartes attendues (${cards.length} reçues)`);
  invariant(new Set(cards.map(cardCode)).size === cards.length, 'Cartes en double dans la main évaluée');

  const sorted = [...cards].sort(byRankDesc);
  const bySuit = new Map<Suit, Card[]>();
  const byRank = new Map<Rank, Card[]>();
  for (const card of sorted) {
    bySuit.set(card.suit, [...(bySuit.get(card.suit) ?? []), card]);
    byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
  }

  const kickers = (used: readonly Card[], count: number): Card[] =>
    sorted.filter((card) => !used.includes(card)).slice(0, count);

  const flush = [...bySuit.values()].find((group) => group.length >= 5);
  if (flush !== undefined) {
    const straightFlush = findStraight(flush);
    if (straightFlush !== null) return made('STRAIGHT_FLUSH', [topRank(straightFlush)], straightFlush);
  }

  // Groupes de rangs : les plus nombreux d'abord, puis les plus hauts.
  const groups = [...byRank.values()].sort(
    (a, b) => b.length - a.length || rankIndex(topRank(b)) - rankIndex(topRank(a)),
  );
  const [first = [], second = []] = groups;

  if (first.length === 4) {
    const kick = kickers(first, 1);
    return made('FOUR_OF_A_KIND', [topRank(first), ...kick.map((c) => c.rank)], [...first, ...kick]);
  }
  if (first.length === 3 && second.length >= 2) {
    return made('FULL_HOUSE', [topRank(first), topRank(second)], [...first, ...second.slice(0, 2)]);
  }
  if (flush !== undefined) {
    const five = flush.slice(0, 5);
    return made('FLUSH', five.map((c) => c.rank), five);
  }
  const straight = findStraight(sorted);
  if (straight !== null) {
    return made('STRAIGHT', [topRank(straight)], straight);
  }
  if (first.length === 3) {
    const kick = kickers(first, 2);
    return made('THREE_OF_A_KIND', [topRank(first), ...kick.map((c) => c.rank)], [...first, ...kick]);
  }
  if (first.length === 2 && second.length === 2) {
    const pairs = [...first, ...second];
    const kick = kickers(pairs, 1);
    return made('TWO_PAIR', [topRank(first), topRank(second), ...kick.map((c) => c.rank)], [...pairs, ...kick]);
  }
  if (first.length === 2) {
    const kick = kickers(first, 3);
    return made('ONE_PAIR', [topRank(first), ...kick.map((c) => c.rank)], [...first, ...kick]);
  }
  const five = sorted.slice(0, 5);
  return made('HIGH_CARD', five.map((c) => c.rank), five);
}

export class HoldemHandEvaluator implements HandEvaluator {
  evaluate(cards: readonly Card[]): EvaluatedHand {
    return evaluateHand(cards);
  }

  compare(a: EvaluatedHand, b: EvaluatedHand): Comparison {
    if (a.score === b.score) return 0;
    return a.score > b.score ? 1 : -1;
  }
}
