import type { ChipRange, Chips, GameEngine, GameTypes, PlayerId } from '../../core/index.js';
import type { RacingRules } from '../rules.js';
import type { RacingCommand, RacingCommandType } from './actions.js';
import type { RacingEvent } from './events.js';
import type { PlacedRaceBet, RaceBetSettlement, RaceCard, RaceResult } from './race.js';
import type { RacingPhase, RacingState } from './state.js';

export interface RacingLegalActions {
  readonly actions: readonly RacingCommandType[];
  readonly stakeRange: ChipRange | null;
}

/** Vue anti-triche : l'arrivée scellée n'apparaît qu'une fois la course courue. */
export interface RacingView {
  readonly phase: RacingPhase;
  readonly viewer: PlayerId | null;
  readonly rules: RacingRules;
  readonly card: RaceCard;
  readonly bankroll: Chips | null;
  readonly bets: readonly PlacedRaceBet[];
  readonly result: RaceResult | null;
  readonly settlements: readonly RaceBetSettlement[];
  readonly legalActions: RacingLegalActions;
}

export interface RacingGame extends GameTypes {
  readonly state: RacingState;
  readonly command: RacingCommand;
  readonly event: RacingEvent;
  readonly view: RacingView;
  readonly viewEvent: RacingEvent;
  readonly legalActions: RacingLegalActions;
}

export type RacingEngine = GameEngine<RacingGame>;
