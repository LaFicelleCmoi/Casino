import type { ChipRange, Chips, GameEngine, GameTypes, PlayerId } from '../../core/index.js';
import type { MinesCommand, MinesCommandType } from './actions.js';
import type { MinesEvent } from './events.js';
import type { MinesPhase, MinesRoundResult, MinesState } from './state.js';

export interface MinesLegalActions {
  readonly actions: readonly MinesCommandType[];
  readonly stakeRange: ChipRange | null;
}

/** Partie en cours telle que la voit le joueur : les bombes restent cachées. */
export interface MinesRoundView {
  readonly stake: Chips;
  readonly mineCount: number;
  readonly revealed: readonly number[];
  readonly multiplier: number;
  readonly nextMultiplier: number;
  readonly nextDiamondChance: number;
  readonly cashOutValue: Chips;
}

export interface MinesView {
  readonly phase: MinesPhase;
  readonly viewer: PlayerId | null;
  readonly bankroll: Chips | null;
  readonly round: MinesRoundView | null;
  readonly lastRound: MinesRoundResult | null;
  readonly legalActions: MinesLegalActions;
}

export interface MinesGame extends GameTypes {
  readonly state: MinesState;
  readonly command: MinesCommand;
  readonly event: MinesEvent;
  readonly view: MinesView;
  readonly viewEvent: MinesEvent;
  readonly legalActions: MinesLegalActions;
}

export type MinesEngine = GameEngine<MinesGame>;
