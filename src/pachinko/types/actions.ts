import type { Chips, PhaseGuard, PlayerCommand } from '../../core/index.js';
import type { PachinkoPhase } from './state.js';

export type PachinkoCommand = (PlayerCommand<'LAUNCH_BALL'> & { readonly stake: Chips }) | PlayerCommand<'FEVER_BALL'>;

export type PachinkoCommandType = PachinkoCommand['type'];

export const PACHINKO_COMMAND_PHASES = {
  LAUNCH_BALL: ['READY'],
  FEVER_BALL: ['FEVER'],
} as const satisfies PhaseGuard<PachinkoPhase, PachinkoCommandType>;
