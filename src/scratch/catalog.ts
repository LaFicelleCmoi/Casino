import { ASTRO } from './games/astro.js';
import { BANCO } from './games/banco.js';
import { CASH } from './games/cash.js';
import { MAXI_MOTS_CROISES, MEGA_MOTS_CROISES, MOTS_CROISES } from './games/crossword.js';
import { MILLIONNAIRE } from './games/millionnaire.js';
import { MORPION } from './games/morpion.js';
import { POLE_POSITION } from './games/pole-position.js';
import { VEGAS } from './games/vegas.js';
import { TICKET_TYPES, type ScratchGameDefinition, type TicketTypeId } from './types/ticket.js';

export const SCRATCH_GAMES: Readonly<Record<TicketTypeId, ScratchGameDefinition>> = {
  BANCO,
  CASH,
  MORPION,
  MILLIONNAIRE,
  VEGAS,
  MOTS_CROISES,
  MAXI_MOTS_CROISES,
  MEGA_MOTS_CROISES,
  ASTRO,
  POLE_POSITION,
};

/** Tickets dans l'ordre de présentation. */
export const SCRATCH_GAME_LIST: readonly ScratchGameDefinition[] = TICKET_TYPES.map((type) => SCRATCH_GAMES[type]);

export function isTicketType(value: string): value is TicketTypeId {
  return (TICKET_TYPES as readonly string[]).includes(value);
}
