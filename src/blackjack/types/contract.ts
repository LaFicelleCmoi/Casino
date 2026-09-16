import type { ChipRange, GameEngine, GameTypes, PlayerId, SeatIndex, VisibleCard } from '../../core/index.js';
import type { BlackjackRules } from '../rules.js';
import type { BlackjackCommand, BlackjackDealerAction, BlackjackPlayerActionType } from './actions.js';
import type { BlackjackEvent, BlackjackViewEvent } from './events.js';
import type { BlackjackScore, HandSettlement, InsuranceSettlement } from './hand.js';
import type { BlackjackPhase, BlackjackSeat, BlackjackState, HandCursor } from './state.js';

export interface BlackjackLegalActions {
  readonly actions: readonly BlackjackPlayerActionType[];
  /** Bornes de mise sur la première case si PLACE_BET est permis (min/max de table, plafonné par le bankroll). */
  readonly betRange: ChipRange | null;
  /**
   * Pendant BETTING : bornes par case, une entrée par case déjà misée plus une pour ouvrir la suivante.
   * null = case au plafond, fonds insuffisants ou aucune place libre pour une case de plus. Vide hors BETTING.
   */
  readonly boxRanges: readonly (ChipRange | null)[];
}

/** Ce que reçoit un client : ni l'ordre du sabot, ni la hole card avant révélation. */
export interface BlackjackTableView {
  readonly phase: BlackjackPhase;
  readonly roundNumber: number;
  readonly rules: BlackjackRules;
  readonly viewer: PlayerId | null;
  readonly viewerSeat: SeatIndex | null;
  readonly seats: readonly (BlackjackSeat | null)[];
  /** Places encore disponibles : rules.seatCount moins un siège par joueur et une place par case supplémentaire. */
  readonly freePlaces: number;
  readonly dealerCards: readonly VisibleCard[];
  /** Score de la seule carte visible tant que la hole card est cachée. */
  readonly dealerScore: BlackjackScore | null;
  readonly shoe: { readonly cardsRemaining: number; readonly reshufflePending: boolean };
  readonly activeHand: HandCursor | null;
  readonly settlements: readonly HandSettlement[];
  readonly insuranceSettlements: readonly InsuranceSettlement[];
  /** Geste attendu du croupier humain pendant DEALER_TURN (règle MANUAL) ; vide sinon. */
  readonly dealerActions: readonly BlackjackDealerAction[];
  readonly legalActions: BlackjackLegalActions;
}

export interface BlackjackGame extends GameTypes {
  readonly state: BlackjackState;
  readonly command: BlackjackCommand;
  readonly event: BlackjackEvent;
  readonly view: BlackjackTableView;
  readonly viewEvent: BlackjackViewEvent;
  readonly legalActions: BlackjackLegalActions;
}

export type BlackjackEngine = GameEngine<BlackjackGame>;
