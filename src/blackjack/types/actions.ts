import type { Chips, PhaseGuard, PlayerCommand, SeatIndex } from '../../core/index.js';
import type { BlackjackPhase } from './state.js';

export type BlackjackPlayerAction =
  | (PlayerCommand<'SIT_DOWN'> & {
      readonly seatIndex: SeatIndex;
      readonly displayName: string;
      readonly buyIn: Chips;
    })
  | PlayerCommand<'LEAVE_SEAT'>
  | (PlayerCommand<'PLACE_BET'> & { readonly amount: Chips })
  | PlayerCommand<'CLEAR_BET'>
  | PlayerCommand<'TAKE_INSURANCE'>
  | PlayerCommand<'DECLINE_INSURANCE'>
  | PlayerCommand<'HIT'>
  | PlayerCommand<'STAND'>
  | PlayerCommand<'DOUBLE_DOWN'>
  | PlayerCommand<'SPLIT'>
  | PlayerCommand<'SURRENDER'>;

/** Commandes émises par l'orchestrateur de table (timer, croupier), pas par un joueur. */
export type BlackjackSystemCommand = { readonly type: 'DEAL' } | { readonly type: 'NEXT_ROUND' };

export type BlackjackCommand = BlackjackPlayerAction | BlackjackSystemCommand;

export type BlackjackPlayerActionType = BlackjackPlayerAction['type'];
export type BlackjackCommandType = BlackjackCommand['type'];

/**
 * Premier niveau de verrouillage de la state machine (par phase).
 * Le second niveau, par règle (Double sur 2 cartes seulement, split de paires, etc.), est vérifié à l'Étape 4.
 */
export const BLACKJACK_COMMAND_PHASES = {
  SIT_DOWN: ['BETTING', 'ROUND_OVER'],
  LEAVE_SEAT: ['BETTING', 'ROUND_OVER'],
  PLACE_BET: ['BETTING'],
  CLEAR_BET: ['BETTING'],
  DEAL: ['BETTING'],
  TAKE_INSURANCE: ['INSURANCE'],
  DECLINE_INSURANCE: ['INSURANCE'],
  HIT: ['PLAYER_TURNS'],
  STAND: ['PLAYER_TURNS'],
  DOUBLE_DOWN: ['PLAYER_TURNS'],
  SPLIT: ['PLAYER_TURNS'],
  SURRENDER: ['PLAYER_TURNS'],
  NEXT_ROUND: ['ROUND_OVER'],
} as const satisfies PhaseGuard<BlackjackPhase, BlackjackCommandType>;
