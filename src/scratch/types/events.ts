import type { Chips } from '../../core/index.js';
import type { TicketEvaluation, TicketTypeId } from './ticket.js';

export type ScratchEvent =
  | {
      readonly type: 'TICKET_BOUGHT';
      readonly serial: string;
      readonly ticketType: TicketTypeId;
      readonly price: Chips;
      readonly bankroll: Chips;
    }
  | { readonly type: 'CELLS_SCRATCHED'; readonly serial: string; readonly cellIds: readonly string[] }
  | { readonly type: 'TICKET_REVEALED'; readonly serial: string; readonly evaluation: TicketEvaluation }
  | { readonly type: 'WINNINGS_PAID'; readonly serial: string; readonly amount: Chips; readonly bankroll: Chips };
