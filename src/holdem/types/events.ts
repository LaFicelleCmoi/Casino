import type { Card, Chips, PlayerId, SeatIndex, VisibleCard } from '../../core/index.js';
import type { PokerBettingActionType } from './actions.js';
import type { Pot, PotAward } from './pot.js';
import type { BlindPositions, Board, HoldemHandOutcome, ShowdownEntry, Street } from './state.js';

/**
 * `C` = Card côté serveur, VisibleCard après projection : les cartes privées d'un adversaire deviennent faces cachées.
 */
export type HoldemEvent<C extends Card | VisibleCard = Card> =
  | { readonly type: 'PLAYER_SAT_DOWN'; readonly seatIndex: SeatIndex; readonly playerId: PlayerId; readonly stack: Chips }
  | { readonly type: 'PLAYER_LEFT'; readonly seatIndex: SeatIndex; readonly playerId: PlayerId }
  | { readonly type: 'PLAYER_SAT_OUT'; readonly seatIndex: SeatIndex }
  | { readonly type: 'PLAYER_SAT_IN'; readonly seatIndex: SeatIndex }
  | { readonly type: 'HAND_STARTED'; readonly handNumber: number; readonly buttonSeat: SeatIndex; readonly blinds: BlindPositions }
  | { readonly type: 'DECK_SHUFFLED' }
  | {
      readonly type: 'FORCED_BET_POSTED';
      readonly seatIndex: SeatIndex;
      readonly kind: 'SMALL_BLIND' | 'BIG_BLIND' | 'ANTE';
      readonly amount: Chips;
      readonly isAllIn: boolean;
    }
  /** Diffusé à tous : seul `playerId` voit ses cartes après projection. */
  | { readonly type: 'HOLE_CARDS_DEALT'; readonly seatIndex: SeatIndex; readonly playerId: PlayerId; readonly cards: readonly [C, C] }
  | { readonly type: 'TURN_STARTED'; readonly seatIndex: SeatIndex }
  | {
      readonly type: 'PLAYER_ACTED';
      readonly seatIndex: SeatIndex;
      readonly action: PokerBettingActionType;
      /** Jetons ajoutés par cette action. */
      readonly amount: Chips;
      readonly streetBet: Chips;
      readonly isAllIn: boolean;
    }
  /** Mise non suivie rendue à son auteur avant le calcul des pots. */
  | { readonly type: 'UNCALLED_BET_RETURNED'; readonly seatIndex: SeatIndex; readonly amount: Chips }
  | { readonly type: 'STREET_DEALT'; readonly street: Exclude<Street, 'PREFLOP'>; readonly cards: readonly Card[]; readonly board: Board }
  | { readonly type: 'POTS_UPDATED'; readonly pots: readonly Pot[] }
  | { readonly type: 'SHOWDOWN'; readonly entries: readonly ShowdownEntry[] }
  | { readonly type: 'POT_AWARDED'; readonly award: PotAward }
  | { readonly type: 'HAND_ENDED'; readonly handNumber: number; readonly outcome: HoldemHandOutcome };

export type HoldemViewEvent = HoldemEvent<VisibleCard>;
