import type { Chips, PhaseGuard, PlayerCommand, SeatIndex } from '../../core/index.js';
import type { BetId, BetSelection } from './bet.js';
import type { RoulettePhase } from './state.js';

export type RoulettePlayerAction =
  | (PlayerCommand<'SIT_DOWN'> & {
      readonly seatIndex: SeatIndex;
      readonly displayName: string;
      readonly buyIn: Chips;
    })
  | PlayerCommand<'LEAVE_SEAT'>
  | (PlayerCommand<'PLACE_BET'> & { readonly bet: BetSelection; readonly amount: Chips })
  | (PlayerCommand<'REMOVE_BET'> & { readonly betId: BetId })
  | PlayerCommand<'CLEAR_BETS'>;

/** Commandes du croupier (ou d'un timer de table), pas d'un joueur. */
export type RouletteSystemCommand =
  | { readonly type: 'CLOSE_BETS' }
  | { readonly type: 'SPIN' }
  | { readonly type: 'NEXT_ROUND' };

export type RouletteCommand = RoulettePlayerAction | RouletteSystemCommand;

export type RoulettePlayerActionType = RoulettePlayerAction['type'];
export type RouletteCommandType = RouletteCommand['type'];

/** Verrouillage par phase, exhaustif à la compilation. */
export const ROULETTE_COMMAND_PHASES = {
  SIT_DOWN: ['BETTING', 'RESULT'],
  LEAVE_SEAT: ['BETTING', 'RESULT'],
  PLACE_BET: ['BETTING'],
  REMOVE_BET: ['BETTING'],
  CLEAR_BETS: ['BETTING'],
  CLOSE_BETS: ['BETTING'],
  SPIN: ['NO_MORE_BETS'],
  NEXT_ROUND: ['RESULT'],
} as const satisfies PhaseGuard<RoulettePhase, RouletteCommandType>;
