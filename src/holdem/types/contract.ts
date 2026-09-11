import type { Card, ChipRange, Chips, GameEngine, GameTypes, PlayerId, SeatIndex, VisibleCard } from '../../core/index.js';
import type { HoldemRules } from '../rules.js';
import type { HoldemCommand } from './actions.js';
import type { HoldemEvent, HoldemViewEvent } from './events.js';
import type { Pot } from './pot.js';
import type { HoldemHandOutcome, HoldemPhase, HoldemState, PokerSeat } from './state.js';

export interface PokerLegalActions {
  readonly canFold: boolean;
  readonly canCheck: boolean;
  /** Jetons à ajouter pour suivre (plafonné au stack) ; null si rien à suivre. */
  readonly callAmount: Chips | null;
  /** Bornes d'ouverture si personne n'a misé sur la street. */
  readonly bet: ChipRange | null;
  /** Bornes en « raise to » ; null si relance interdite (stack insuffisant ou action non rouverte). */
  readonly raise: ChipRange | null;
  readonly allInAmount: Chips | null;
}

export type PokerSeatView = Omit<PokerSeat, 'holeCards'> & {
  readonly holeCards: readonly [VisibleCard, VisibleCard] | null;
};

export interface HoldemTableView {
  readonly phase: HoldemPhase;
  readonly handNumber: number;
  readonly rules: HoldemRules;
  readonly viewer: PlayerId | null;
  readonly viewerSeat: SeatIndex | null;
  readonly buttonSeat: SeatIndex | null;
  readonly seats: readonly (PokerSeatView | null)[];
  readonly board: readonly Card[];
  /** Pot principal + side pots dérivés des contributions. */
  readonly pots: readonly Pot[];
  readonly toAct: SeatIndex | null;
  readonly legalActions: PokerLegalActions | null;
  readonly outcome: HoldemHandOutcome | null;
}

export interface HoldemGame extends GameTypes {
  readonly state: HoldemState;
  readonly command: HoldemCommand;
  readonly event: HoldemEvent;
  readonly view: HoldemTableView;
  readonly viewEvent: HoldemViewEvent;
  readonly legalActions: PokerLegalActions | null;
}

export type HoldemEngine = GameEngine<HoldemGame>;
