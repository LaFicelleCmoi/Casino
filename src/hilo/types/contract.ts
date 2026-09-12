import type { ChipRange, Chips, GameEngine, GameTypes, PlayerId } from '../../core/index.js';
import type { HiloCard } from '../cards.js';
import type { HiloCommand, HiloCommandType } from './actions.js';
import type { HiloEvent } from './events.js';
import type { HiloPhase, HiloRoundResult, HiloState, HiloStep } from './state.js';

export interface HiloLegalActions {
  readonly actions: readonly HiloCommandType[];
  readonly stakeRange: ChipRange | null;
}

export interface HiloChoice {
  readonly allowed: boolean;
  readonly chance: number;
  readonly multiplier: number;
}

/** La carte suivante n'apparaît pas dans la vue. */
export interface HiloRoundView {
  readonly stake: Chips;
  readonly current: HiloCard;
  readonly multiplier: number;
  readonly streak: number;
  readonly jokersLeft: number;
  readonly steps: readonly HiloStep[];
  readonly higher: HiloChoice;
  readonly lower: HiloChoice;
  readonly cashOutValue: Chips;
}

export interface HiloView {
  readonly phase: HiloPhase;
  readonly viewer: PlayerId | null;
  readonly bankroll: Chips | null;
  readonly round: HiloRoundView | null;
  readonly lastRound: HiloRoundResult | null;
  readonly legalActions: HiloLegalActions;
}

export interface HiloGame extends GameTypes {
  readonly state: HiloState;
  readonly command: HiloCommand;
  readonly event: HiloEvent;
  readonly view: HiloView;
  readonly viewEvent: HiloEvent;
  readonly legalActions: HiloLegalActions;
}

export type HiloEngine = GameEngine<HiloGame>;
