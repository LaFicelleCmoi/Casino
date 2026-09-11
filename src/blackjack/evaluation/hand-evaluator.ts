import type { Card, Rank } from '../../core/index.js';
import type { BlackjackRules } from '../rules.js';
import type { BlackjackScore, HandOutcome, PlayerHand } from '../types/hand.js';
import type { BlackjackSeat } from '../types/state.js';

const CARD_VALUES: Readonly<Record<Rank, number>> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 10,
  Q: 10,
  K: 10,
  A: 1,
};

/** Valeur « hard » : l'As vaut 1 ici, le passage à 11 est décidé par scoreCards. */
export function cardValue(card: Card): number {
  return CARD_VALUES[card.rank];
}

/**
 * Un seul As peut valoir 11 (deux feraient 22) : il suffit donc de calculer le total hard
 * et d'ajouter 10 si la main contient un As et que cela ne dépasse pas 21.
 */
export function scoreCards(cards: readonly Card[], fromSplit = false): BlackjackScore {
  let hardTotal = 0;
  let hasAce = false;
  for (const card of cards) {
    hardTotal += cardValue(card);
    hasAce ||= card.rank === 'A';
  }
  const isSoft = hasAce && hardTotal + 10 <= 21;
  const total = isSoft ? hardTotal + 10 : hardTotal;
  return {
    total,
    isSoft,
    isBust: total > 21,
    isBlackjack: !fromSplit && cards.length === 2 && total === 21,
  };
}

export function scoreHand(hand: PlayerHand): BlackjackScore {
  return scoreCards(hand.cards, hand.fromSplit);
}

/** IA du croupier : tire sous 17 ; sur soft 17, tire uniquement en H17. */
export function dealerShouldHit(score: BlackjackScore, rules: BlackjackRules): boolean {
  return score.total < 17 || (score.total === 17 && score.isSoft && rules.dealerHitsSoft17);
}

export function dealerShouldPeek(upCard: Card, rules: BlackjackRules): boolean {
  return rules.dealerPeeks && (upCard.rank === 'A' || cardValue(upCard) === 10);
}

export function isInsuranceOffered(upCard: Card, rules: BlackjackRules): boolean {
  return rules.insurance && upCard.rank === 'A';
}

/** Un As splitté ne reçoit qu'une carte, sauf règle hitSplitAces. */
function isLockedSplitAce(hand: PlayerHand, rules: BlackjackRules): boolean {
  return hand.isSplitAces && !rules.hitSplitAces;
}

export function canHit(hand: PlayerHand, rules: BlackjackRules): boolean {
  return hand.status === 'PLAYING' && !isLockedSplitAce(hand, rules) && scoreHand(hand).total < 21;
}

export function canStand(hand: PlayerHand): boolean {
  return hand.status === 'PLAYING';
}

export function canDouble(hand: PlayerHand, rules: BlackjackRules): boolean {
  if (hand.status !== 'PLAYING' || hand.cards.length !== 2) return false;
  if (hand.fromSplit && !rules.doubleAfterSplit) return false;
  if (isLockedSplitAce(hand, rules)) return false;

  const { total } = scoreHand(hand);
  switch (rules.doubleRestriction) {
    case 'ANY_TWO':
      return true;
    case 'NINE_TO_ELEVEN':
      return total >= 9 && total <= 11;
    case 'TEN_OR_ELEVEN':
      return total === 10 || total === 11;
  }
}

export function canSplit(seat: BlackjackSeat, hand: PlayerHand, rules: BlackjackRules): boolean {
  if (hand.status !== 'PLAYING' || hand.cards.length !== 2) return false;
  if (seat.hands.length >= rules.maxHandsPerSeat) return false;

  const [first, second] = hand.cards;
  if (first === undefined || second === undefined) return false;

  const matches =
    rules.splitMatching === 'SAME_RANK' ? first.rank === second.rank : cardValue(first) === cardValue(second);
  return matches && !(hand.isSplitAces && !rules.resplitAces);
}

/** Late surrender : sur les 2 cartes initiales, avant toute autre action, jamais après un split. */
export function canSurrender(seat: BlackjackSeat, hand: PlayerHand, rules: BlackjackRules): boolean {
  return (
    rules.surrender === 'LATE' &&
    hand.status === 'PLAYING' &&
    hand.cards.length === 2 &&
    !hand.fromSplit &&
    seat.hands.length === 1
  );
}

export function resolveOutcome(hand: PlayerHand, dealer: BlackjackScore): HandOutcome {
  if (hand.status === 'SURRENDERED') return 'SURRENDER';

  const player = scoreHand(hand);
  if (player.isBust) return 'LOSS';
  if (player.isBlackjack) return dealer.isBlackjack ? 'PUSH' : 'BLACKJACK';
  if (dealer.isBlackjack) return 'LOSS';
  if (dealer.isBust || player.total > dealer.total) return 'WIN';
  return player.total === dealer.total ? 'PUSH' : 'LOSS';
}
