import {
  EngineError,
  addChips,
  err,
  invariant,
  isChips,
  ok,
  subtractChips,
  type PlayerId,
  type RandomSource,
  type Result,
  type Transition,
} from '../../core/index.js';
import { SCRATCH_GAMES, isTicketType } from '../catalog.js';
import { drawPrize } from '../prizes.js';
import { SCRATCH_COMMAND_PHASES, type ScratchCommand, type ScratchCommandType } from '../types/actions.js';
import type { ScratchEngine, ScratchLegalActions, ScratchSessionView, TicketView, VisibleScratchCell } from '../types/contract.js';
import type { ScratchEvent } from '../types/events.js';
import type { ScratchIdlePhase, ScratchRevealedPhase, ScratchState, ScratchingPhase } from '../types/state.js';
import { TICKET_TYPES, type Ticket } from '../types/ticket.js';

type Step = Result<Transition<ScratchState, ScratchEvent>>;

const NO_ACTIONS: ScratchLegalActions = { actions: [], affordable: [] };

function done(state: ScratchState, events: readonly ScratchEvent[] = []): Step {
  return ok({ state, events });
}

export function ticketCellIds(ticket: Pick<Ticket, 'zones'>): string[] {
  return ticket.zones.flatMap((zone) => zone.groups.flatMap((group) => group.cells.map((cell) => cell.id)));
}

/**
 * Game Controller des tickets à gratter. Le lot est tiré à l'achat, la grille imprimée pour le produire, puis relue par
 * l'évaluateur : un désaccord est un bug (InvariantViolation). Gratter ne change rien au gain, il le découvre.
 */
export class ScratchController implements ScratchEngine {
  readonly #rng: RandomSource;

  constructor(rng: RandomSource) {
    this.#rng = rng;
  }

  createSession(playerId: PlayerId, bankroll: number): Result<ScratchIdlePhase> {
    if (!isChips(bankroll)) return err(new EngineError('INVALID_AMOUNT', `Solde invalide : ${bankroll}`));
    const session: ScratchIdlePhase = { phase: 'IDLE', player: { id: playerId, bankroll }, ticketsSold: 0, ticket: null };
    return ok(session);
  }

  apply(state: ScratchState, command: ScratchCommand): Step {
    const allowedPhases: readonly string[] = SCRATCH_COMMAND_PHASES[command.type];
    if (!allowedPhases.includes(state.phase)) {
      return err(new EngineError('ILLEGAL_PHASE', `${command.type} impossible pendant la phase ${state.phase}`));
    }
    if (command.playerId !== state.player.id) {
      return err(new EngineError('UNKNOWN_PLAYER', "Ce joueur n'est pas le titulaire de la session"));
    }
    try {
      switch (command.type) {
        case 'BUY_TICKET':
          invariant(state.phase !== 'SCRATCHING', 'Achat pendant le grattage');
          return this.#buy(state, command.ticketType);
        case 'SCRATCH_CELL': {
          invariant(state.phase === 'SCRATCHING', 'Grattage sans ticket');
          if (!ticketCellIds(state.ticket).includes(command.cellId)) {
            return err(new EngineError('ILLEGAL_ACTION', `Case inexistante : ${command.cellId}`));
          }
          if (state.ticket.scratched.includes(command.cellId)) {
            return err(new EngineError('ILLEGAL_ACTION', 'Cette case est déjà grattée'));
          }
          return this.#scratch(state, [command.cellId]);
        }
        case 'SCRATCH_ZONE': {
          invariant(state.phase === 'SCRATCHING', 'Grattage sans ticket');
          const zone = state.ticket.zones.find((candidate) => candidate.id === command.zoneId);
          if (zone === undefined) return err(new EngineError('ILLEGAL_ACTION', `Zone inexistante : ${command.zoneId}`));
          const remaining = ticketCellIds({ zones: [zone] }).filter((id) => !state.ticket.scratched.includes(id));
          if (remaining.length === 0) return err(new EngineError('ILLEGAL_ACTION', 'Cette zone est déjà grattée'));
          return this.#scratch(state, remaining);
        }
        case 'SCRATCH_ALL': {
          invariant(state.phase === 'SCRATCHING', 'Grattage sans ticket');
          return this.#scratch(state, ticketCellIds(state.ticket).filter((id) => !state.ticket.scratched.includes(id)));
        }
      }
    } catch (error) {
      if (error instanceof EngineError) return err(error);
      throw error;
    }
  }

  legalActions(state: ScratchState, playerId: PlayerId): ScratchLegalActions {
    if (playerId !== state.player.id) return NO_ACTIONS;
    const affordable = TICKET_TYPES.filter((type) => SCRATCH_GAMES[type].price <= state.player.bankroll);
    const actions: ScratchCommandType[] =
      state.phase === 'SCRATCHING' ? ['SCRATCH_CELL', 'SCRATCH_ZONE', 'SCRATCH_ALL'] : affordable.length > 0 ? ['BUY_TICKET'] : [];
    return { actions, affordable };
  }

  project(state: ScratchState, viewer: PlayerId | null): ScratchSessionView {
    return {
      phase: state.phase,
      viewer,
      bankroll: viewer === state.player.id ? state.player.bankroll : null,
      ticketsSold: state.ticketsSold,
      ticket: state.ticket === null ? null : projectTicket(state.ticket, state.phase === 'REVEALED'),
      legalActions: viewer === null ? NO_ACTIONS : this.legalActions(state, viewer),
    };
  }

  /** Les événements ne contiennent aucune case non grattée : TICKET_REVEALED n'est émis qu'une fois tout découvert. */
  projectEvent(event: ScratchEvent, _viewer: PlayerId | null): ScratchEvent {
    return event;
  }

  #buy(state: ScratchIdlePhase | ScratchRevealedPhase, ticketType: string): Step {
    if (!isTicketType(ticketType)) return err(new EngineError('ILLEGAL_ACTION', `Ticket inconnu : ${ticketType}`));
    const game = SCRATCH_GAMES[ticketType];
    if (state.player.bankroll < game.price) {
      return err(new EngineError('INSUFFICIENT_FUNDS', `Il faut ${game.price} jetons pour un ticket ${game.name}`, { price: game.price }));
    }

    const prize = drawPrize(this.#rng, game.prizes);
    const zones = game.generate(this.#rng, prize);
    const evaluation = game.evaluate(zones);
    invariant(evaluation.total === prize, `Ticket ${game.name} mal imprimé : lot ${prize}, grille évaluée à ${evaluation.total}`);
    invariant(ticketCellIds({ zones }).length > 0, `Ticket ${game.name} sans case à gratter`);

    const ticketsSold = state.ticketsSold + 1;
    const check = this.#rng.nextInt(0x10000).toString(16).toUpperCase().padStart(4, '0');
    const ticket: Ticket = {
      serial: `${game.serialPrefix}-${String(ticketsSold).padStart(6, '0')}-${check}`,
      type: ticketType,
      price: game.price,
      zones,
      scratched: [],
      evaluation,
    };
    const bankroll = subtractChips(state.player.bankroll, game.price);
    const next: ScratchingPhase = { phase: 'SCRATCHING', player: { ...state.player, bankroll }, ticketsSold, ticket };
    return done(next, [{ type: 'TICKET_BOUGHT', serial: ticket.serial, ticketType, price: game.price, bankroll }]);
  }

  #scratch(state: ScratchingPhase, cellIds: readonly string[]): Step {
    const ticket: Ticket = { ...state.ticket, scratched: [...state.ticket.scratched, ...cellIds] };
    const events: ScratchEvent[] = [{ type: 'CELLS_SCRATCHED', serial: ticket.serial, cellIds }];
    if (ticket.scratched.length < ticketCellIds(ticket).length) {
      return done({ ...state, ticket }, events);
    }

    const bankroll = addChips(state.player.bankroll, ticket.evaluation.total);
    events.push(
      { type: 'TICKET_REVEALED', serial: ticket.serial, evaluation: ticket.evaluation },
      { type: 'WINNINGS_PAID', serial: ticket.serial, amount: ticket.evaluation.total, bankroll },
    );
    const revealed: ScratchRevealedPhase = { phase: 'REVEALED', player: { ...state.player, bankroll }, ticketsSold: state.ticketsSold, ticket };
    return done(revealed, events);
  }
}

function projectTicket(ticket: Ticket, revealed: boolean): TicketView {
  const scratched = new Set(ticket.scratched);
  return {
    serial: ticket.serial,
    type: ticket.type,
    price: ticket.price,
    zones: ticket.zones.map((zone) => ({
      ...zone,
      groups: zone.groups.map((group) => ({
        ...group,
        cells: group.cells.map((cell): VisibleScratchCell => (scratched.has(cell.id) ? { ...cell, scratched: true } : { id: cell.id, scratched: false })),
      })),
    })),
    scratchedCount: scratched.size,
    cellCount: ticketCellIds(ticket).length,
    evaluation: revealed ? ticket.evaluation : null,
  };
}
