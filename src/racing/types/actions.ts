import type { Chips, PhaseGuard, PlayerCommand } from '../../core/index.js';
import type { RaceBetSelection } from './race.js';
import type { RacingPhase } from './state.js';

export type RacingPlayerCommand =
  | (PlayerCommand<'PLACE_BET'> & { readonly bet: RaceBetSelection; readonly stake: Chips })
  | (PlayerCommand<'CANCEL_BET'> & { readonly betId: string })
  | PlayerCommand<'CLEAR_BETS'>;

/** Commandes du starter, pas d'un parieur. */
export type RacingSystemCommand = { readonly type: 'START_RACE' } | { readonly type: 'NEXT_RACE' };

export type RacingCommand = RacingPlayerCommand | RacingSystemCommand;
export type RacingCommandType = RacingCommand['type'];

export const RACING_COMMAND_PHASES = {
  PLACE_BET: ['BETTING'],
  CANCEL_BET: ['BETTING'],
  CLEAR_BETS: ['BETTING'],
  START_RACE: ['BETTING'],
  NEXT_RACE: ['FINISHED'],
} as const satisfies PhaseGuard<RacingPhase, RacingCommandType>;
