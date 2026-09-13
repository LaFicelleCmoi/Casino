import type { BigChipRange, GameEngine, GameTypes, PlayerId, SeatIndex } from '../../core/index.js';
import type { RouletteRules } from '../rules.js';
import type { RouletteNumber, SpinOutcome } from '../wheel/pockets.js';
import type { WheelSpin } from '../wheel/roulette-wheel.js';
import type { RoulettePlayerActionType, RouletteCommand } from './actions.js';
import type { RouletteEvent } from './events.js';
import type { SeatSettlement } from './settlement.js';
import type { RoulettePhase, RouletteSeat, RouletteState } from './state.js';

export interface RouletteLegalActions {
  readonly actions: readonly RoulettePlayerActionType[];
  /** Bornes d'une nouvelle pose de jetons (mise minimale, plafonds de table éventuels, solde) ; null si PLACE_BET est impossible. */
  readonly betRange: BigChipRange | null;
}

/** À la roulette rien n'est caché : la vue expose tout l'état, plus les actions légales du spectateur. */
export interface RouletteTableView {
  readonly phase: RoulettePhase;
  readonly roundNumber: number;
  readonly rules: RouletteRules;
  readonly viewer: PlayerId | null;
  readonly viewerSeat: SeatIndex | null;
  readonly seats: readonly (RouletteSeat | null)[];
  readonly history: readonly RouletteNumber[];
  readonly lastSpin: { readonly spin: WheelSpin; readonly outcome: SpinOutcome } | null;
  readonly settlements: readonly SeatSettlement[];
  readonly legalActions: RouletteLegalActions;
}

export interface RouletteGame extends GameTypes {
  readonly state: RouletteState;
  readonly command: RouletteCommand;
  readonly event: RouletteEvent;
  readonly view: RouletteTableView;
  readonly viewEvent: RouletteEvent;
  readonly legalActions: RouletteLegalActions;
}

export type RouletteEngine = GameEngine<RouletteGame>;
