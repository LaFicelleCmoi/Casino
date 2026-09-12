import type { ChipRange, Chips, GameEngine, GameTypes, PlayerId } from '../../core/index.js';
import type { Volatility } from '../board.js';
import type { PlinkoCommand, PlinkoCommandType } from './actions.js';
import type { PlinkoEvent } from './events.js';
import type { PlinkoDrop, PlinkoPhase, PlinkoState } from './state.js';

export interface PlinkoLegalActions {
  readonly actions: readonly PlinkoCommandType[];
  readonly stakeRange: ChipRange | null;
}

export interface PlinkoView {
  readonly phase: PlinkoPhase;
  readonly viewer: PlayerId | null;
  readonly bankroll: Chips | null;
  readonly volatility: Volatility;
  readonly multipliers: readonly number[];
  readonly lastDrops: readonly PlinkoDrop[];
  readonly legalActions: PlinkoLegalActions;
}

export interface PlinkoGame extends GameTypes {
  readonly state: PlinkoState;
  readonly command: PlinkoCommand;
  readonly event: PlinkoEvent;
  readonly view: PlinkoView;
  readonly viewEvent: PlinkoEvent;
  readonly legalActions: PlinkoLegalActions;
}

export type PlinkoEngine = GameEngine<PlinkoGame>;
