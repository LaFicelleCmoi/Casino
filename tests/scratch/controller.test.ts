import { describe, expect, it } from 'vitest';
import { SeededRandomSource, playerId } from '../../src/core/index.js';
import { ScratchController, ticketCellIds, type ScratchCommand, type ScratchState } from '../../src/scratch/index.js';
import { expectError, unwrap } from '../helpers.js';

const alice = playerId('alice');
const controller = new ScratchController(new SeededRandomSource('scratch-controller'));

function run(state: ScratchState, ...commands: ScratchCommand[]): ScratchState {
  return commands.reduce<ScratchState>((current, command) => unwrap(controller.apply(current, command)).state, state);
}

const session = (bankroll = 100): ScratchState => unwrap(controller.createSession(alice, bankroll));
const buy = (ticketType: 'BANCO' | 'POLE_POSITION' | 'MEGA_MOTS_CROISES'): ScratchCommand => ({ type: 'BUY_TICKET', playerId: alice, ticketType });

describe('achat', () => {
  it('débite le prix et imprime un ticket numéroté', () => {
    const state = run(session(), buy('POLE_POSITION'));
    expect(state.phase).toBe('SCRATCHING');
    expect(state.player.bankroll).toBe(95);
    expect(state.ticket?.serial).toMatch(/^PPJ-000001-[0-9A-F]{4}$/);
    expect(state.ticket?.scratched).toEqual([]);
  });

  it('refuse un ticket trop cher, inconnu, ou acheté par un autre joueur', () => {
    expectError(controller.apply(session(4), buy('POLE_POSITION')), 'INSUFFICIENT_FUNDS');
    expectError(controller.apply(session(), { type: 'BUY_TICKET', playerId: alice, ticketType: 'LOTO' as 'BANCO' }), 'ILLEGAL_ACTION');
    expectError(controller.apply(session(), { type: 'BUY_TICKET', playerId: playerId('bob'), ticketType: 'BANCO' }), 'UNKNOWN_PLAYER');
  });

  it('interdit d’acheter un second ticket avant d’avoir fini de gratter', () => {
    expectError(controller.apply(run(session(), buy('BANCO')), buy('BANCO')), 'ILLEGAL_PHASE');
  });
});

describe('grattage', () => {
  it('découvre les cases une à une et paie le gain à la dernière', () => {
    const bought = run(session(), buy('MEGA_MOTS_CROISES'));
    const ticket = bought.ticket;
    if (ticket === null) throw new Error('ticket attendu');
    const ids = ticketCellIds(ticket);

    const first = unwrap(controller.apply(bought, { type: 'SCRATCH_CELL', playerId: alice, cellId: ids[0] ?? '' }));
    expect(first.state.phase).toBe('SCRATCHING');
    expectError(controller.apply(first.state, { type: 'SCRATCH_CELL', playerId: alice, cellId: ids[0] ?? '' }), 'ILLEGAL_ACTION');
    expectError(controller.apply(first.state, { type: 'SCRATCH_CELL', playerId: alice, cellId: 'nulle.part.0' }), 'ILLEGAL_ACTION');

    const finished = unwrap(controller.apply(first.state, { type: 'SCRATCH_ALL', playerId: alice }));
    expect(finished.state.phase).toBe('REVEALED');
    expect(finished.state.player.bankroll).toBe(90 + ticket.evaluation.total);
    expect(finished.events.map((event) => event.type)).toEqual(['CELLS_SCRATCHED', 'TICKET_REVEALED', 'WINNINGS_PAID']);
  });

  it('gratte une zone entière d’un coup', () => {
    const bought = run(session(), buy('POLE_POSITION'));
    const scratched = run(bought, { type: 'SCRATCH_ZONE', playerId: alice, zoneId: 'duel' });
    expect(scratched.ticket?.scratched).toHaveLength(3);
    expectError(controller.apply(scratched, { type: 'SCRATCH_ZONE', playerId: alice, zoneId: 'duel' }), 'ILLEGAL_ACTION');
  });

  it('masque les cases non grattées et le résultat dans la vue', () => {
    const bought = run(session(), buy('POLE_POSITION'));
    const cellId = ticketCellIds(bought.ticket ?? { zones: [] })[0] ?? '';
    const view = controller.project(run(bought, { type: 'SCRATCH_CELL', playerId: alice, cellId }), alice);
    const cells = view.ticket?.zones.flatMap((zone) => zone.groups.flatMap((group) => group.cells)) ?? [];
    expect(cells.filter((cell) => cell.scratched)).toHaveLength(1);
    expect(cells.find((cell) => !cell.scratched)).not.toHaveProperty('label');
    expect(view.ticket?.evaluation).toBeNull();
    expect(controller.project(bought, null).bankroll).toBeNull();
  });
});

describe('robustesse', () => {
  it('enchaîne 3 000 tickets de tous types sans écart de comptabilité', () => {
    const types = ['BANCO', 'CASH', 'MORPION', 'MILLIONNAIRE', 'VEGAS', 'MOTS_CROISES', 'MAXI_MOTS_CROISES', 'MEGA_MOTS_CROISES', 'ASTRO', 'POLE_POSITION'] as const;
    let state = session(1_000_000);
    let expected = 1_000_000;
    for (let i = 0; i < 3_000; i += 1) {
      const ticketType = types[i % types.length] ?? 'BANCO';
      state = run(state, { type: 'BUY_TICKET', playerId: alice, ticketType }, { type: 'SCRATCH_ALL', playerId: alice });
      expected += (state.ticket?.evaluation.total ?? 0) - (state.ticket?.price ?? 0);
      expect(state.player.bankroll).toBe(expected);
    }
    expect(state.ticketsSold).toBe(3_000);
  });
});
