import type { PhaseGuard, PlayerCommand } from '../../core/index.js';
import type { ScratchPhase } from './state.js';
import type { TicketTypeId } from './ticket.js';

export type ScratchCommand =
  | (PlayerCommand<'BUY_TICKET'> & { readonly ticketType: TicketTypeId })
  | (PlayerCommand<'SCRATCH_CELL'> & { readonly cellId: string })
  | (PlayerCommand<'SCRATCH_ZONE'> & { readonly zoneId: string })
  | PlayerCommand<'SCRATCH_ALL'>;

export type ScratchCommandType = ScratchCommand['type'];

export const SCRATCH_COMMAND_PHASES = {
  BUY_TICKET: ['IDLE', 'REVEALED'],
  SCRATCH_CELL: ['SCRATCHING'],
  SCRATCH_ZONE: ['SCRATCHING'],
  SCRATCH_ALL: ['SCRATCHING'],
} as const satisfies PhaseGuard<ScratchPhase, ScratchCommandType>;
