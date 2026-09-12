import type { Chips, GameEngine, GameTypes, PlayerId } from '../../core/index.js';
import type { ScratchCommand, ScratchCommandType } from './actions.js';
import type { ScratchEvent } from './events.js';
import type { ScratchPhase, ScratchState } from './state.js';
import type { CellGroup, ScratchCell, ScratchZone, TicketEvaluation, TicketTypeId } from './ticket.js';

/** Anti-triche : une case non grattée ne révèle que son id. */
export type VisibleScratchCell =
  | { readonly id: string; readonly scratched: false }
  | (ScratchCell & { readonly scratched: true });

export type VisibleCellGroup = Omit<CellGroup, 'cells'> & { readonly cells: readonly VisibleScratchCell[] };

export type VisibleScratchZone = Omit<ScratchZone, 'groups'> & { readonly groups: readonly VisibleCellGroup[] };

export interface TicketView {
  readonly serial: string;
  readonly type: TicketTypeId;
  readonly price: Chips;
  readonly zones: readonly VisibleScratchZone[];
  readonly scratchedCount: number;
  readonly cellCount: number;
  /** null tant que la pellicule n'est pas entièrement grattée. */
  readonly evaluation: TicketEvaluation | null;
}

export interface ScratchLegalActions {
  readonly actions: readonly ScratchCommandType[];
  /** Tickets que le solde permet d'acheter. */
  readonly affordable: readonly TicketTypeId[];
}

export interface ScratchSessionView {
  readonly phase: ScratchPhase;
  readonly viewer: PlayerId | null;
  /** Visible du seul joueur de la session. */
  readonly bankroll: Chips | null;
  readonly ticketsSold: number;
  readonly ticket: TicketView | null;
  readonly legalActions: ScratchLegalActions;
}

export interface ScratchGame extends GameTypes {
  readonly state: ScratchState;
  readonly command: ScratchCommand;
  readonly event: ScratchEvent;
  readonly view: ScratchSessionView;
  readonly viewEvent: ScratchEvent;
  readonly legalActions: ScratchLegalActions;
}

export type ScratchEngine = GameEngine<ScratchGame>;
