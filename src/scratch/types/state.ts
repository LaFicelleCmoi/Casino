import type { Chips, PlayerId } from '../../core/index.js';
import type { Ticket } from './ticket.js';

/*
 * Machine à états d'une session de grattage :
 *
 *   IDLE ──BUY_TICKET──▶ SCRATCHING ──(dernière case grattée)──▶ REVEALED ──BUY_TICKET──▶ SCRATCHING
 *
 * Le prix est débité à l'achat ; le gain, déjà imprimé, est crédité quand toute la pellicule est grattée.
 */

export interface ScratchPlayer {
  readonly id: PlayerId;
  readonly bankroll: Chips;
}

export interface ScratchSessionBase {
  readonly player: ScratchPlayer;
  readonly ticketsSold: number;
}

export interface ScratchIdlePhase extends ScratchSessionBase {
  readonly phase: 'IDLE';
  readonly ticket: null;
}

export interface ScratchingPhase extends ScratchSessionBase {
  readonly phase: 'SCRATCHING';
  readonly ticket: Ticket;
}

export interface ScratchRevealedPhase extends ScratchSessionBase {
  readonly phase: 'REVEALED';
  readonly ticket: Ticket;
}

export type ScratchState = ScratchIdlePhase | ScratchingPhase | ScratchRevealedPhase;

export type ScratchPhase = ScratchState['phase'];
