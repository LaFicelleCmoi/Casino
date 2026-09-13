import type { Card, Chips, PlayerId, SeatIndex, VisibleCard } from '../../core/index.js';
import type { BlackjackScore, HandId, HandSettlement, PlayerHandStatus } from './hand.js';
import type { HandCursor } from './state.js';

export type CardTarget =
  | { readonly kind: 'DEALER' }
  | { readonly kind: 'PLAYER'; readonly seatIndex: SeatIndex; readonly handId: HandId };

/**
 * Événements émis par le moteur, dans l'ordre chronologique : l'UI les rejoue pour animer la table.
 * `C` = Card côté serveur, VisibleCard après projection (la hole card du croupier devient face cachée).
 */
export type BlackjackEvent<C extends Card | VisibleCard = Card> =
  | { readonly type: 'PLAYER_SAT_DOWN'; readonly seatIndex: SeatIndex; readonly playerId: PlayerId; readonly bankroll: Chips }
  | { readonly type: 'PLAYER_LEFT'; readonly seatIndex: SeatIndex; readonly playerId: PlayerId }
  | { readonly type: 'BET_PLACED'; readonly seatIndex: SeatIndex; readonly box: number; readonly amount: Chips }
  | { readonly type: 'BET_CLEARED'; readonly seatIndex: SeatIndex }
  | { readonly type: 'SHOE_SHUFFLED'; readonly deckCount: number }
  | { readonly type: 'CARD_DEALT'; readonly target: CardTarget; readonly card: C; readonly faceUp: boolean }
  | { readonly type: 'INSURANCE_OFFERED' }
  | { readonly type: 'INSURANCE_DECIDED'; readonly seatIndex: SeatIndex; readonly taken: boolean; readonly stake: Chips }
  | { readonly type: 'DEALER_PEEKED'; readonly hasBlackjack: boolean }
  | { readonly type: 'TURN_STARTED'; readonly cursor: HandCursor }
  | { readonly type: 'HAND_SPLIT'; readonly seatIndex: SeatIndex; readonly handId: HandId; readonly newHandId: HandId }
  | { readonly type: 'HAND_DOUBLED'; readonly seatIndex: SeatIndex; readonly handId: HandId; readonly newBet: Chips }
  | { readonly type: 'HAND_STATUS_CHANGED'; readonly seatIndex: SeatIndex; readonly handId: HandId; readonly status: PlayerHandStatus }
  | { readonly type: 'HOLE_CARD_REVEALED'; readonly card: Card }
  | { readonly type: 'DEALER_FINISHED'; readonly score: BlackjackScore }
  | { readonly type: 'HAND_SETTLED'; readonly settlement: HandSettlement }
  | { readonly type: 'INSURANCE_SETTLED'; readonly seatIndex: SeatIndex; readonly returned: Chips }
  | { readonly type: 'ROUND_ENDED'; readonly roundNumber: number };

export type BlackjackViewEvent = BlackjackEvent<VisibleCard>;
