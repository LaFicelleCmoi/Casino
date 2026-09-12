import type { ChipRange, Chips, GameEngine, GameTypes, PlayerId } from '../../core/index.js';
import type { PachinkoCommand, PachinkoCommandType } from './actions.js';
import type { PachinkoEvent } from './events.js';
import type { PachinkoBall, PachinkoPhase, PachinkoState } from './state.js';

export interface PachinkoLegalActions {
  readonly actions: readonly PachinkoCommandType[];
  readonly stakeRange: ChipRange | null;
}

export interface PachinkoView {
  readonly phase: PachinkoPhase;
  readonly viewer: PlayerId | null;
  readonly bankroll: Chips | null;
  readonly feverBallsLeft: number;
  readonly lastBalls: readonly PachinkoBall[];
  readonly legalActions: PachinkoLegalActions;
}

export interface PachinkoGame extends GameTypes {
  readonly state: PachinkoState;
  readonly command: PachinkoCommand;
  readonly event: PachinkoEvent;
  readonly view: PachinkoView;
  readonly viewEvent: PachinkoEvent;
  readonly legalActions: PachinkoLegalActions;
}

export type PachinkoEngine = GameEngine<PachinkoGame>;
