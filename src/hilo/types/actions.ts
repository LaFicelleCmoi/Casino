import type { Chips, PhaseGuard, PlayerCommand } from '../../core/index.js';
import type { HiloDirection } from '../cards.js';
import type { HiloPhase } from './state.js';

export type HiloCommand =
  | (PlayerCommand<'START_ROUND'> & { readonly stake: Chips })
  | (PlayerCommand<'GUESS'> & { readonly direction: HiloDirection })
  | PlayerCommand<'JOKER'>
  | PlayerCommand<'CASH_OUT'>;

export type HiloCommandType = HiloCommand['type'];

export const HILO_COMMAND_PHASES = {
  START_ROUND: ['IDLE'],
  GUESS: ['PLAYING'],
  JOKER: ['PLAYING'],
  CASH_OUT: ['PLAYING'],
} as const satisfies PhaseGuard<HiloPhase, HiloCommandType>;
