import { describe, expect, it } from 'vitest';
import { SeededRandomSource, chips, playerId } from '../../src/core/index.js';
import {
  RacingController,
  STANDARD_RACING_RULES,
  payoutOf,
  type RaceBetSelection,
  type RacingBettingPhase,
  type RacingCommand,
  type RacingState,
} from '../../src/racing/index.js';
import { expectError, unwrap } from '../helpers.js';

const alice = playerId('alice');
const controller = new RacingController(new SeededRandomSource('racing-controller'));

function run(state: RacingState, ...commands: RacingCommand[]): RacingState {
  return commands.reduce<RacingState>((current, command) => unwrap(controller.apply(current, command)).state, state);
}

function session(bankroll = 1_000): RacingBettingPhase {
  return unwrap(controller.createSession(alice, bankroll));
}

const bet = (selection: RaceBetSelection, stake: number): RacingCommand => ({ type: 'PLACE_BET', playerId: alice, bet: selection, stake: chips(stake) });

describe('programme et paris', () => {
  it('publie 8 partants avec leurs cotes et cache l’arrivée dans la vue', () => {
    const state = session();
    expect(state.card.horses).toHaveLength(8);
    expect(state.card.odds.every((odds) => odds.win > 100 && odds.place >= 105)).toBe(true);
    expect(controller.project(state, alice).result).toBeNull();
  });

  it('débite la mise et fige la cote au moment du pari', () => {
    const placed = run(session(), bet({ kind: 'TIERCE_ORDRE', horses: [1, 2, 3] }, 10));
    expect(placed.player.bankroll).toBe(990);
    if (placed.phase !== 'BETTING') throw new Error('phase BETTING attendue');
    expect(placed.bets[0]).toMatchObject({ id: 'C1-P1', kind: 'TIERCE_ORDRE', horses: [1, 2, 3], stake: 10 });
    expect(placed.bets[0]?.odds).toBeGreaterThan(1_000);
  });

  it('refuse les sélections invalides, les mises hors limites et les soldes insuffisants', () => {
    expectError(controller.apply(session(), bet({ kind: 'TIERCE_ORDRE', horses: [1, 1, 2] }, 10)), 'INVALID_BET');
    expectError(controller.apply(session(), bet({ kind: 'GAGNANT', horses: [9] }, 10)), 'INVALID_BET');
    expectError(controller.apply(session(), bet({ kind: 'GAGNANT', horses: [1] }, 0)), 'INVALID_AMOUNT');
    expectError(controller.apply(session(5), bet({ kind: 'GAGNANT', horses: [1] }, 10)), 'INSUFFICIENT_FUNDS');
    expectError(controller.apply(session(), { type: 'CLEAR_BETS', playerId: playerId('bob') }), 'UNKNOWN_PLAYER');
  });

  it('rembourse un pari annulé et tous les paris effacés', () => {
    const placed = run(session(), bet({ kind: 'GAGNANT', horses: [2] }, 30), bet({ kind: 'PLACE', horses: [4] }, 20));
    const cancelled = run(placed, { type: 'CANCEL_BET', playerId: alice, betId: 'C1-P1' });
    expect(cancelled.player.bankroll).toBe(980);
    expect(run(cancelled, { type: 'CLEAR_BETS', playerId: alice }).player.bankroll).toBe(1_000);
  });
});

describe('course', () => {
  it('règle chaque pari selon l’arrivée scellée', () => {
    const base = session();
    const rigged: RacingBettingPhase = { ...base, sealedResult: { order: [5, 2, 7, 1, 3, 4, 6, 8], times: [] } };
    const placed = run(
      rigged,
      bet({ kind: 'GAGNANT', horses: [5] }, 10),
      bet({ kind: 'PLACE', horses: [7] }, 10),
      bet({ kind: 'TIERCE_DESORDRE', horses: [7, 5, 2] }, 10),
      bet({ kind: 'QUINTE_ORDRE', horses: [5, 2, 7, 3, 1] }, 10),
    );
    if (placed.phase !== 'BETTING') throw new Error('phase BETTING attendue');
    const finished = run(placed, { type: 'START_RACE' });
    if (finished.phase !== 'FINISHED') throw new Error('phase FINISHED attendue');

    expect(finished.settlements.map((settlement) => settlement.won)).toEqual([true, true, true, false]);
    const expectedPaid = placed.bets.slice(0, 3).reduce((total, placedBet) => total + payoutOf(placedBet.stake, placedBet.odds), 0);
    expect(finished.player.bankroll).toBe(960 + expectedPaid);
    expect(finished.net).toBe(expectedPaid - 40);
    expect(controller.project(finished, alice).result?.order).toEqual([5, 2, 7, 1, 3, 4, 6, 8]);
  });

  it('enchaîne les courses et verrouille les paris une fois la course partie', () => {
    const finished = run(session(), { type: 'START_RACE' });
    expectError(controller.apply(finished, bet({ kind: 'GAGNANT', horses: [1] }, 10)), 'ILLEGAL_PHASE');
    const next = run(finished, { type: 'NEXT_RACE' });
    expect(next.phase).toBe('BETTING');
    expect(next.card.raceNumber).toBe(2);
  });

  it('tient une comptabilité exacte sur 400 courses', () => {
    let state: RacingState = session(1_000_000);
    const kinds = ['GAGNANT', 'PLACE', 'TIERCE_DESORDRE'] as const;
    let expected = 1_000_000;
    for (let race = 0; race < 400; race += 1) {
      const kind = kinds[race % kinds.length] ?? 'GAGNANT';
      const horses = kind === 'TIERCE_DESORDRE' ? [1, 2, 3] : [(race % 8) + 1];
      state = run(state, bet({ kind, horses } as unknown as RaceBetSelection, 25), { type: 'START_RACE' });
      if (state.phase !== 'FINISHED') throw new Error('phase FINISHED attendue');
      expected += state.net;
      expect(state.player.bankroll).toBe(expected);
      state = run(state, { type: 'NEXT_RACE' });
    }
    expect(STANDARD_RACING_RULES.runners).toBe(8);
  });
});
