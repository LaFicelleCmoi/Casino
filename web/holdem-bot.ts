import { chips, rankIndex, type ChipRange, type RandomSource } from '../src/core/index.js';
import {
  HAND_CATEGORIES,
  evaluateHand,
  type HandInProgress,
  type HoleCards,
  type PokerBettingAction,
  type PokerLegalActions,
  type PokerSeat,
} from '../src/holdem/index.js';

/** Force approximative d'une main de départ, entre 0 et 1 (AA ≈ 0,97 ; 72 dépareillé ≈ 0,2). */
function preflopStrength([first, second]: HoleCards): number {
  const high = Math.max(rankIndex(first.rank), rankIndex(second.rank));
  const low = Math.min(rankIndex(first.rank), rankIndex(second.rank));
  if (high === low) return 0.55 + high * 0.035;
  let strength = ((high + low) / 24) * 0.6;
  if (first.suit === second.suit) strength += 0.05;
  if (high - low === 1) strength += 0.03;
  return Math.min(strength, 0.9);
}

const CATEGORY_STRENGTH = [0.12, 0.42, 0.62, 0.74, 0.8, 0.85, 0.92, 0.97, 0.99] as const;

function postflopStrength(cards: HoleCards, board: HandInProgress['board']): number {
  const hand = evaluateHand([...cards, ...board]);
  return CATEGORY_STRENGTH[HAND_CATEGORIES.indexOf(hand.category)] ?? 0;
}

/**
 * IA volontairement simple : force de main estimée, bruit aléatoire (bluffs, prudence) et cotes du pot.
 * Elle ne lit que ses propres cartes et le board, comme un joueur humain.
 */
export function chooseBotAction(
  state: HandInProgress,
  seat: PokerSeat,
  legal: PokerLegalActions,
  rng: RandomSource,
): PokerBettingAction {
  const playerId = seat.player.id;
  const fold: PokerBettingAction = { type: 'FOLD', playerId };
  if (seat.holeCards === null) return fold;

  const base = state.board.length === 0 ? preflopStrength(seat.holeCards) : postflopStrength(seat.holeCards, state.board);
  const strength = base + rng.nextInt(21) / 100 - 0.1;

  const pot = state.seats.reduce((sum, s) => sum + (s?.totalCommitted ?? 0), 0);
  const toCall = legal.callAmount ?? 0;
  const potOdds = toCall === 0 ? 0 : toCall / (pot + toCall);
  const sized = (range: ChipRange): ReturnType<typeof chips> =>
    chips(Math.min(range.max, Math.max(range.min, Math.round(range.min + pot * 0.5))));

  if (strength > 0.8) {
    if (legal.raise !== null) return { type: 'RAISE', playerId, raiseTo: sized(legal.raise) };
    if (legal.bet !== null) return { type: 'BET', playerId, amount: sized(legal.bet) };
  }
  if (strength > 0.58 && legal.bet !== null && rng.nextInt(2) === 0) {
    return { type: 'BET', playerId, amount: sized(legal.bet) };
  }
  if (legal.canCheck) return { type: 'CHECK', playerId };
  if (legal.callAmount !== null) {
    const cheap = toCall <= state.rules.bigBlind && strength > 0.3;
    if (cheap || strength > potOdds + 0.25) return { type: 'CALL', playerId };
  }
  return fold;
}
