import type { Chips, PhaseGuard, PlayerCommand } from '../../core/index.js';
import type { MinesPhase } from './state.js';

export type MinesCommand =
  | (PlayerCommand<'START_ROUND'> & { readonly stake: Chips; readonly mines: number })
  | (PlayerCommand<'REVEAL'> & { readonly tile: number })
  | PlayerCommand<'CASH_OUT'>;

export type MinesCommandType = MinesCommand['type'];

export const MINES_COMMAND_PHASES = {
  START_ROUND: ['IDLE'],
  REVEAL: ['PLAYING'],
  CASH_OUT: ['PLAYING'],
} as const satisfies PhaseGuard<MinesPhase, MinesCommandType>;
