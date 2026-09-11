import type { Chips, PhaseGuard, PlayerCommand, SeatIndex } from '../../core/index.js';
import { STREETS, type HoldemPhase } from './state.js';

export type PokerBettingAction =
  | PlayerCommand<'FOLD'>
  | PlayerCommand<'CHECK'>
  | PlayerCommand<'CALL'>
  /** Ouverture de la mise sur une street où personne n'a misé. */
  | (PlayerCommand<'BET'> & { readonly amount: Chips })
  /** Sémantique « raise to » : montant TOTAL visé sur la street, pas l'incrément. */
  | (PlayerCommand<'RAISE'> & { readonly raiseTo: Chips })
  | PlayerCommand<'ALL_IN'>;

export type PokerTableAction =
  | (PlayerCommand<'SIT_DOWN'> & {
      readonly seatIndex: SeatIndex;
      readonly displayName: string;
      readonly buyIn: Chips;
    })
  /** LEAVE_SEAT, SIT_OUT et SIT_IN : entre deux mains uniquement, pour que les jetons engagés restent dans les pots. */
  | PlayerCommand<'LEAVE_SEAT'>
  | PlayerCommand<'SIT_OUT'>
  | PlayerCommand<'SIT_IN'>;

export type HoldemSystemCommand = { readonly type: 'START_HAND' };

export type HoldemCommand = PokerBettingAction | PokerTableAction | HoldemSystemCommand;

export type PokerBettingActionType = PokerBettingAction['type'];
export type HoldemCommandType = HoldemCommand['type'];

const ANY_PHASE = ['WAITING', ...STREETS, 'HAND_COMPLETE'] as const;

/**
 * Premier niveau de verrouillage (par phase). Miser sur la River avant le Turn est impossible
 * puisque la phase RIVER n'existe qu'après le TURN. Montants, tour de parole et droit de relance : Étape 4.
 */
export const HOLDEM_COMMAND_PHASES = {
  FOLD: STREETS,
  CHECK: STREETS,
  CALL: STREETS,
  BET: STREETS,
  RAISE: STREETS,
  ALL_IN: STREETS,
  SIT_DOWN: ANY_PHASE,
  LEAVE_SEAT: ANY_PHASE,
  SIT_OUT: ANY_PHASE,
  SIT_IN: ANY_PHASE,
  START_HAND: ['WAITING', 'HAND_COMPLETE'],
} as const satisfies PhaseGuard<HoldemPhase, HoldemCommandType>;
