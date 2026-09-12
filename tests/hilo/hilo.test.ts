import { describe, expect, it } from 'vitest';
import { SeededRandomSource, chips, playerId, type RandomSource } from '../../src/core/index.js';
import {
  HILO_RANKS,
  HiloController,
  formatHiloMultiplier,
  isGuessAllowed,
  stepMultiplier,
  winChance,
  type HiloCommand,
  type HiloPlayingPhase,
  type HiloState,
} from '../../src/hilo/index.js';
import { expectError, unwrap } from '../helpers.js';

const alice = playerId('alice');

/** Aléa scripté : chaque carte consomme [enseigne, rang − 1]. */
function scripted(...values: number[]): RandomSource {
  const fallback = new SeededRandomSource('hilo-fallback');
  return { nextInt: (max) => values.shift() ?? fallback.nextInt(max) };
}
const cardValues = (...ranks: number[]): number[] => ranks.flatMap((rank) => [0, rank - 1]);

function run(controller: HiloController, state: HiloState, ...commands: HiloCommand[]): HiloState {
  return commands.reduce<HiloState>((current, command) => unwrap(controller.apply(current, command)).state, state);
}

function playing(state: HiloState): HiloPlayingPhase {
  if (state.phase !== 'PLAYING') throw new Error('partie en cours attendue');
  return state;
}

const start = (stake: number): HiloCommand => ({ type: 'START_ROUND', playerId: alice, stake: chips(stake) });
const guess = (direction: 'HIGHER' | 'LOWER'): HiloCommand => ({ type: 'GUESS', playerId: alice, direction });

describe('cotes', () => {
  it('rendent 98 à 99 % de la mise en espérance pour chaque pronostic proposé', () => {
    for (let rank = 1; rank <= HILO_RANKS; rank += 1) {
      for (const direction of ['HIGHER', 'LOWER'] as const) {
        if (!isGuessAllowed(rank, direction)) continue;
        const expected = winChance(rank, direction) * (stepMultiplier(rank, direction, 0.01) / 100);
        expect(expected).toBeLessThanOrEqual(0.99 + 1e-9);
        expect(expected).toBeGreaterThan(0.98);
      }
    }
  });

  it('écartent les pronostics gagnés d’avance et comptent l’égalité comme gagnante', () => {
    expect(isGuessAllowed(1, 'HIGHER')).toBe(false);
    expect(isGuessAllowed(13, 'LOWER')).toBe(false);
    expect(winChance(7, 'HIGHER') + winChance(7, 'LOWER')).toBeCloseTo(14 / 13, 12);
    expect(stepMultiplier(1, 'LOWER', 0.01)).toBe(1_287);
    expect(formatHiloMultiplier(183)).toBe('1,83');
  });
});

describe('HiloController', () => {
  it('multiplie la série à chaque pronostic gagné puis encaisse', () => {
    const controller = new HiloController(scripted(...cardValues(7, 10, 10, 4)));
    let state = run(controller, unwrap(controller.createSession(alice, 1_000)), start(100));
    expect(state.player.bankroll).toBe(900);
    expect(controller.project(state, alice).round).not.toHaveProperty('next');

    state = run(controller, state, guess('HIGHER'));
    expect(playing(state).round).toMatchObject({ multiplier: 183, streak: 1, current: { rank: 10 } });
    state = run(controller, state, guess('HIGHER'));
    const expected = Math.floor((183 * stepMultiplier(10, 'HIGHER', 0.01)) / 100);
    expect(playing(state).round.multiplier).toBe(expected);

    const cashed = run(controller, state, { type: 'CASH_OUT', playerId: alice });
    expect(cashed.player.bankroll).toBe(900 + Math.floor((100 * expected) / 100));
  });

  it('perd la mise sur un mauvais pronostic', () => {
    const controller = new HiloController(scripted(...cardValues(10, 12)));
    const lost = run(controller, run(controller, unwrap(controller.createSession(alice, 1_000)), start(50)), guess('LOWER'));
    expect(lost.phase).toBe('IDLE');
    expect(lost.player.bankroll).toBe(950);
    if (lost.phase === 'IDLE') expect(lost.lastRound).toMatchObject({ outcome: 'LOST', payout: 0, lastCard: { rank: 12 } });
  });

  it('fait passer la carte avec un joker, trois fois au plus', () => {
    const controller = new HiloController(new SeededRandomSource('hilo-joker'));
    let state = run(controller, unwrap(controller.createSession(alice, 1_000)), start(10));
    const joker: HiloCommand = { type: 'JOKER', playerId: alice };
    const hidden = playing(state).round.next;
    state = run(controller, state, joker);
    expect(playing(state).round).toMatchObject({ current: hidden, jokersLeft: 2, multiplier: 100 });
    state = run(controller, state, joker, joker);
    expectError(controller.apply(state, joker), 'ILLEGAL_ACTION');
  });

  it('refuse les actions invalides', () => {
    const controller = new HiloController(scripted(...cardValues(1, 5)));
    const session = unwrap(controller.createSession(alice, 20));
    expectError(controller.apply(session, start(0)), 'INVALID_AMOUNT');
    expectError(controller.apply(session, start(30)), 'INSUFFICIENT_FUNDS');
    expectError(controller.apply(session, guess('HIGHER')), 'ILLEGAL_PHASE');
    const started = run(controller, session, start(10));
    expectError(controller.apply(started, guess('HIGHER')), 'ILLEGAL_ACTION');
    expectError(controller.apply(started, { type: 'CASH_OUT', playerId: alice }), 'ILLEGAL_ACTION');
    expectError(controller.apply(started, { type: 'JOKER', playerId: playerId('bob') }), 'UNKNOWN_PLAYER');
  });

  it('tient une comptabilité exacte sur 2 000 parties au hasard', () => {
    const controller = new HiloController(new SeededRandomSource('hilo-simulation'));
    const strategy = new SeededRandomSource('hilo-strategie');
    let state: HiloState = unwrap(controller.createSession(alice, 1_000_000));
    let expected = 1_000_000;
    for (let i = 0; i < 2_000; i += 1) {
      state = run(controller, state, start(10));
      const target = 1 + strategy.nextInt(4);
      while (state.phase === 'PLAYING' && state.round.streak < target) {
        const { rank } = state.round.current;
        // Pari le plus probable parmi ceux proposés : « plus haut » sur un As est gagné d'avance, donc refusé.
        const direction = rank <= 7 && isGuessAllowed(rank, 'HIGHER') ? 'HIGHER' : isGuessAllowed(rank, 'LOWER') ? 'LOWER' : 'HIGHER';
        state = run(controller, state, guess(direction));
      }
      if (state.phase === 'PLAYING') state = run(controller, state, { type: 'CASH_OUT', playerId: alice });
      if (state.phase !== 'IDLE' || state.lastRound === null) throw new Error('partie terminée attendue');
      expected += state.lastRound.net;
      expect(state.player.bankroll).toBe(expected);
    }
  });
});
