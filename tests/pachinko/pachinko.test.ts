import { describe, expect, it } from 'vitest';
import { SeededRandomSource, chips, playerId, type RandomSource } from '../../src/core/index.js';
import {
  FEVER_BALLS,
  POCKETS,
  POCKET_TOTAL_WEIGHT,
  PachinkoController,
  TOP_POCKET,
  pocketForRoll,
  returnToPlayer,
  rollForPocket,
  type PachinkoCommand,
  type PachinkoState,
} from '../../src/pachinko/index.js';
import { expectError, unwrap } from '../helpers.js';

const alice = playerId('alice');

function scripted(...values: number[]): RandomSource {
  const fallback = new SeededRandomSource('pachinko-fallback');
  return { nextInt: (max) => values.shift() ?? fallback.nextInt(max) };
}

function run(controller: PachinkoController, state: PachinkoState, ...commands: PachinkoCommand[]): PachinkoState {
  return commands.reduce<PachinkoState>((current, command) => unwrap(controller.apply(current, command)).state, state);
}

const launch = (stake: number): PachinkoCommand => ({ type: 'LAUNCH_BALL', playerId: alice, stake: chips(stake) });
const feverBall: PachinkoCommand = { type: 'FEVER_BALL', playerId: alice };
const bonusPocket = POCKETS.findIndex((pocket) => pocket.metal === 'BONUS');

describe('plateau', () => {
  it('a des poches symétriques et un retour théorique entre 94 et 97 %', () => {
    expect([...POCKETS].reverse()).toEqual(POCKETS);
    expect(POCKET_TOTAL_WEIGHT).toBe(93);
    expect(POCKETS[TOP_POCKET]?.metal).toBe('PLATINE');
    expect(returnToPlayer()).toBeGreaterThan(0.94);
    expect(returnToPlayer()).toBeLessThan(0.97);
  });

  it('associe chaque tirage à sa poche', () => {
    POCKETS.forEach((_, index) => expect(pocketForRoll(rollForPocket(index))).toBe(index));
    expect(pocketForRoll(POCKET_TOTAL_WEIGHT - 1)).toBe(POCKETS.length - 1);
  });
});

describe('PachinkoController', () => {
  it('paie la poche Platine ×10', () => {
    const controller = new PachinkoController(scripted(rollForPocket(TOP_POCKET)));
    const state = run(controller, unwrap(controller.createSession(alice, 100)), launch(10));
    expect(state.lastBalls[0]).toMatchObject({ pocket: TOP_POCKET, multiplier: 1_000, payout: 100 });
    expect(state.player.bankroll).toBe(190);
  });

  it('déclenche le Fever Mode sur 777 : 10 billes gratuites aux gains doublés', () => {
    const controller = new PachinkoController(scripted(rollForPocket(bonusPocket), 0, rollForPocket(TOP_POCKET)));
    let state = run(controller, unwrap(controller.createSession(alice, 100)), launch(10));
    expect(state).toMatchObject({ phase: 'FEVER', feverBallsLeft: FEVER_BALLS, feverStake: 10, player: { bankroll: 100 } });
    expect(state.lastBalls[0]?.slot).toEqual([7, 7, 7]);
    expectError(controller.apply(state, launch(10)), 'ILLEGAL_PHASE');

    state = run(controller, state, feverBall);
    expect(state.lastBalls[0]).toMatchObject({ free: true, multiplier: 2_000, payout: 200 });
    for (let i = 1; i < FEVER_BALLS; i += 1) state = run(controller, state, feverBall);
    expect(state.phase).toBe('READY');
    expectError(controller.apply(state, feverBall), 'ILLEGAL_PHASE');
  });

  it('n’affiche jamais trois chiffres identiques sans jackpot', () => {
    const controller = new PachinkoController(scripted(rollForPocket(bonusPocket), 3, 4, 4));
    const state = run(controller, unwrap(controller.createSession(alice, 100)), launch(10));
    const slot = state.lastBalls[0]?.slot ?? [0, 0, 0];
    expect(state.phase).toBe('READY');
    expect(new Set(slot).size).toBeGreaterThan(1);
  });

  it('refuse les mises invalides', () => {
    const controller = new PachinkoController(new SeededRandomSource('pachinko-errors'));
    const session = unwrap(controller.createSession(alice, 5));
    expectError(controller.apply(session, launch(0)), 'INVALID_AMOUNT');
    expectError(controller.apply(session, launch(10)), 'INSUFFICIENT_FUNDS');
    expectError(controller.apply(session, { type: 'LAUNCH_BALL', playerId: playerId('bob'), stake: chips(1) }), 'UNKNOWN_PLAYER');
  });

  it('retrouve le retour théorique et une comptabilité exacte sur 60 000 billes', () => {
    const controller = new PachinkoController(new SeededRandomSource('pachinko-simulation'));
    let state = unwrap(controller.createSession(alice, 1_000_000_000));
    let paid = 0;
    let won = 0;
    for (let i = 0; i < 60_000; i += 1) {
      state = run(controller, state, launch(10));
      paid += 10;
      won += state.lastBalls[0]?.payout ?? 0;
      while (state.phase === 'FEVER') {
        state = run(controller, state, feverBall);
        won += state.lastBalls[0]?.payout ?? 0;
      }
    }
    expect(state.player.bankroll).toBe(1_000_000_000 - paid + won);
    expect(won / paid).toBeCloseTo(returnToPlayer(), 1);
  }, 30_000);
});
