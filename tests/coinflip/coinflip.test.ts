import { describe, expect, it } from 'vitest';
import { SeededRandomSource, chips, playerId, type RandomSource } from '../../src/core/index.js';
import {
  COINFLIP_HISTORY_SIZE,
  CoinflipController,
  STANDARD_COINFLIP_RULES,
  coinflipHouseEdge,
  otherSide,
  validateCoinflipRules,
  type CoinSide,
  type CoinflipCommand,
  type CoinflipState,
} from '../../src/coinflip/index.js';
import { expectError, unwrap } from '../helpers.js';

const alice = playerId('alice');
const controller = new CoinflipController(new SeededRandomSource('pile-ou-face'));

const session = (bankroll = 1_000): CoinflipState => unwrap(controller.createSession(alice, bankroll));
const flip = (stake: number, call: CoinSide): CoinflipCommand => ({ type: 'FLIP', playerId: alice, stake: chips(stake), call });
const ride = (call: CoinSide): CoinflipCommand => ({ type: 'RIDE', playerId: alice, call });
const run = (state: CoinflipState, command: CoinflipCommand): CoinflipState => unwrap(controller.apply(state, command)).state;

/** Annonce toujours le bon côté (ou le mauvais), en lisant le côté tiré d'avance. */
const winning = (state: CoinflipState): CoinSide => state.upcoming;
const losing = (state: CoinflipState): CoinSide => otherSide(state.upcoming);

describe('règles du Pile ou Face', () => {
  it('paie ×1,98, soit 1 % pour la maison', () => {
    expect(coinflipHouseEdge(STANDARD_COINFLIP_RULES)).toBeCloseTo(0.01, 12);
  });

  it('refuse un gain hors de ]×1 ; ×2] et une série hors de 1 à 20', () => {
    expect(validateCoinflipRules({ ...STANDARD_COINFLIP_RULES, payout: { numerator: 5, denominator: 2 } }).ok).toBe(false);
    expect(validateCoinflipRules({ ...STANDARD_COINFLIP_RULES, payout: { numerator: 1, denominator: 1 } }).ok).toBe(false);
    expect(validateCoinflipRules({ ...STANDARD_COINFLIP_RULES, maxChain: 0 }).ok).toBe(false);
    expect(validateCoinflipRules(STANDARD_COINFLIP_RULES).ok).toBe(true);
  });
});

describe('CoinflipController', () => {
  it('paie un bon pronostic ×1,98 et encaisse la mise d’un mauvais', () => {
    const start = session();
    const won = run(start, flip(100, winning(start)));
    expect(won.player.bankroll).toBe(1_098);
    expect(won.lastFlip).toMatchObject({ won: true, stake: 100, payout: 198, net: 98, chain: 1, side: start.upcoming });
    const lost = run(won, flip(100, losing(won)));
    expect(lost.player.bankroll).toBe(998);
    expect(lost.lastFlip).toMatchObject({ won: false, payout: 0, net: -100 });
  });

  it('arrondit le gain à l’unité inférieure', () => {
    const start = session();
    expect(run(start, flip(3, winning(start))).lastFlip?.payout).toBe(5);
  });

  it('refuse une mise hors limites, supérieure au solde ou un côté inconnu', () => {
    const start = session(50);
    expectError(controller.apply(start, flip(0, 'PILE')), 'INVALID_AMOUNT');
    expectError(controller.apply(start, flip(60, 'PILE')), 'INSUFFICIENT_FUNDS');
    expectError(controller.apply(unwrap(controller.createSession(alice, 5_000_000)), flip(2_000_000, 'PILE')), 'BET_OUT_OF_LIMITS');
    expectError(controller.apply(start, { type: 'FLIP', playerId: alice, stake: chips(10), call: 'TRANCHE' as CoinSide }), 'ILLEGAL_ACTION');
    expectError(controller.apply(start, { ...flip(10, 'PILE'), playerId: playerId('bob') }), 'UNKNOWN_PLAYER');
  });

  it('quitte ou double : remet tout le gain en jeu et compte la série', () => {
    let state = session();
    expectError(controller.apply(state, ride('PILE')), 'ILLEGAL_ACTION');
    state = run(state, flip(100, winning(state)));
    expect(controller.legalActions(state, alice).rideStake).toBe(198);
    state = run(state, ride(winning(state)));
    expect(state.lastFlip).toMatchObject({ stake: 198, payout: 392, chain: 2 });
    expect(state.player.bankroll).toBe(1_000 - 100 + 198 - 198 + 392);
    expect(state.stats.bestChain).toBe(2);
    state = run(state, ride(losing(state)));
    expect(state.lastFlip).toMatchObject({ stake: 392, payout: 0, chain: 3 });
    expect(state.player.bankroll).toBe(1_000 - 100);
    expect(controller.legalActions(state, alice).rideStake).toBeNull();
    expectError(controller.apply(state, ride('FACE')), 'ILLEGAL_ACTION');
  });

  it('arrête la série au plafond de quitte ou double', () => {
    let state = unwrap(controller.createSession(alice, 1_000, { ...STANDARD_COINFLIP_RULES, maxChain: 2 }));
    state = run(state, flip(10, winning(state)));
    state = run(state, ride(winning(state)));
    expect(controller.legalActions(state, alice).actions).toEqual(['FLIP']);
    expectError(controller.apply(state, ride(winning(state))), 'ILLEGAL_ACTION');
  });

  it('cache le prochain côté dans la vue et tient l’historique et les statistiques', () => {
    let state = session(100_000);
    for (let i = 0; i < COINFLIP_HISTORY_SIZE + 20; i += 1) state = run(state, flip(1, i % 2 === 0 ? 'PILE' : 'FACE'));
    const view = controller.project(state, alice);
    expect(JSON.stringify(view)).not.toContain('upcoming');
    expect(view.history).toHaveLength(COINFLIP_HISTORY_SIZE);
    expect(view.history[0]).toBe(state.lastFlip?.side);
    expect(view.stats.flips).toBe(COINFLIP_HISTORY_SIZE + 20);
    expect(view.stats.pile + view.stats.face).toBe(view.stats.flips);
    expect(view.run?.side).toBe(view.history[0]);
    expect(controller.project(state, null).bankroll).toBeNull();
  });

  it('tombe sur Pile une fois sur deux, à 1 % près sur 20 000 lancers', () => {
    let state = session(1_000_000);
    for (let i = 0; i < 20_000; i += 1) state = run(state, flip(1, 'PILE'));
    expect(state.stats.pile / state.stats.flips).toBeGreaterThan(0.49);
    expect(state.stats.pile / state.stats.flips).toBeLessThan(0.51);
  });

  it('rejoue une session à l’identique avec la même seed', () => {
    const play = (rng: RandomSource): CoinSide[] => {
      const engine = new CoinflipController(rng);
      let state = unwrap(engine.createSession(alice, 1_000));
      for (let i = 0; i < 30; i += 1) state = unwrap(engine.apply(state, flip(1, 'FACE'))).state;
      return [...state.history];
    };
    expect(play(new SeededRandomSource('seed'))).toEqual(play(new SeededRandomSource('seed')));
  });
});
