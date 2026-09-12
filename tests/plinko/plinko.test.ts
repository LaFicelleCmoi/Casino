import { describe, expect, it } from 'vitest';
import { SeededRandomSource, chips, playerId, type RandomSource } from '../../src/core/index.js';
import {
  MULTIPLIERS,
  PLINKO_BUCKETS,
  PLINKO_ROWS,
  PlinkoController,
  VOLATILITIES,
  bucketProbability,
  formatMultiplier,
  returnToPlayer,
  type PlinkoCommand,
  type PlinkoState,
  type Volatility,
} from '../../src/plinko/index.js';
import { expectError, unwrap } from '../helpers.js';

const alice = playerId('alice');
const constant = (value: number): RandomSource => ({ nextInt: () => value });

function run(controller: PlinkoController, state: PlinkoState, ...commands: PlinkoCommand[]): PlinkoState {
  return commands.reduce<PlinkoState>((current, command) => unwrap(controller.apply(current, command)).state, state);
}

const drop = (stake: number): PlinkoCommand => ({ type: 'DROP_BALL', playerId: alice, stake: chips(stake) });
const volatility = (value: Volatility): PlinkoCommand => ({ type: 'SET_VOLATILITY', playerId: alice, volatility: value });

describe('pyramide', () => {
  it.each(VOLATILITIES)('%s : 17 cases symétriques, retour théorique entre 95 et 99 %', (value) => {
    const table = MULTIPLIERS[value];
    expect(table).toHaveLength(PLINKO_BUCKETS);
    expect([...table].reverse()).toEqual(table);
    expect(returnToPlayer(value)).toBeGreaterThan(0.95);
    expect(returnToPlayer(value)).toBeLessThan(0.99);
  });

  it('paie ×1000 aux extrémités en volatilité élevée', () => {
    expect(formatMultiplier(MULTIPLIERS.HIGH[0] ?? 0)).toBe('1000');
    expect(formatMultiplier(MULTIPLIERS.HIGH[8] ?? 0)).toBe('0,2');
  });

  it('suit la loi binomiale B(16, ½)', () => {
    const total = Array.from({ length: PLINKO_BUCKETS }, (_, bucket) => bucketProbability(bucket)).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 12);
    expect(bucketProbability(0)).toBe(1 / 65_536);
  });
});

describe('PlinkoController', () => {
  it('débite la mise, suit le trajet et crédite mise × multiplicateur', () => {
    const controller = new PlinkoController(new SeededRandomSource('plinko'));
    const state = run(controller, unwrap(controller.createSession(alice, 1_000)), volatility('LOW'), drop(100));
    const [last] = state.lastDrops;
    expect(last).toBeDefined();
    if (last === undefined) return;
    expect(last.path).toHaveLength(PLINKO_ROWS);
    expect(last.bucket).toBe(last.path.filter((direction) => direction === 'R').length);
    expect(last.payout).toBe(Math.floor((100 * (MULTIPLIERS.LOW[last.bucket] ?? 0)) / 100));
    expect(state.player.bankroll).toBe(900 + last.payout);
  });

  it('envoie la bille au bord quand l’aléa tire toujours du même côté', () => {
    const controller = new PlinkoController(constant(0));
    const state = run(controller, unwrap(controller.createSession(alice, 100)), volatility('HIGH'), drop(10));
    expect(state.lastDrops[0]).toMatchObject({ bucket: 0, multiplier: 100_000, payout: 10_000 });
    expect(state.player.bankroll).toBe(10_090);
  });

  it('refuse les mises invalides, les soldes insuffisants et les volatilités inconnues', () => {
    const controller = new PlinkoController(constant(1));
    const session = unwrap(controller.createSession(alice, 50));
    expectError(controller.apply(session, drop(0)), 'INVALID_AMOUNT');
    expectError(controller.apply(session, drop(60)), 'INSUFFICIENT_FUNDS');
    expectError(controller.apply(session, volatility('EXTREME' as Volatility)), 'ILLEGAL_ACTION');
    expectError(controller.apply(session, { type: 'DROP_BALL', playerId: playerId('bob'), stake: chips(1) }), 'UNKNOWN_PLAYER');
  });

  it('répartit les billes selon la loi binomiale et garde une comptabilité exacte', () => {
    const controller = new PlinkoController(new SeededRandomSource('plinko-distribution'));
    let state = run(controller, unwrap(controller.createSession(alice, 1_000_000_000)), volatility('HIGH'));
    let centre = 0;
    let expected: number = state.player.bankroll;
    const drops = 20_000;
    for (let i = 0; i < drops; i += 1) {
      state = run(controller, state, drop(10));
      const last = state.lastDrops[0];
      if (last?.bucket === 8) centre += 1;
      expected += (last?.payout ?? 0) - 10;
    }
    expect(state.player.bankroll).toBe(expected);
    expect(centre / drops).toBeCloseTo(bucketProbability(8), 1);
    expect(state.dropCount).toBe(drops);
  });
});
