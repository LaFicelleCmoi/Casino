import { describe, expect, it } from 'vitest';
import { SeededRandomSource, chips, playerId } from '../../src/core/index.js';
import {
  MINES_TILES,
  MinesController,
  formatMultiplier,
  minesMultiplier,
  nextDiamondChance,
  survivalChance,
  type MinesCommand,
  type MinesPlayingPhase,
  type MinesState,
} from '../../src/mines/index.js';
import { expectError, unwrap } from '../helpers.js';

const alice = playerId('alice');
const controller = new MinesController(new SeededRandomSource('mines'));

function run(state: MinesState, ...commands: MinesCommand[]): MinesState {
  return commands.reduce<MinesState>((current, command) => unwrap(controller.apply(current, command)).state, state);
}

const session = (bankroll = 1_000): MinesState => unwrap(controller.createSession(alice, bankroll));
const start = (stake: number, mines: number): MinesCommand => ({ type: 'START_ROUND', playerId: alice, stake: chips(stake), mines });
const reveal = (tile: number): MinesCommand => ({ type: 'REVEAL', playerId: alice, tile });

function playing(state: MinesState): MinesPlayingPhase {
  if (state.phase !== 'PLAYING') throw new Error('partie en cours attendue');
  return state;
}

const safeTiles = (state: MinesPlayingPhase): number[] =>
  Array.from({ length: MINES_TILES }, (_, tile) => tile).filter((tile) => !state.round.mines.includes(tile));

describe('multiplicateurs', () => {
  it('rendent 99 % de la mise en espérance, à l’arrondi du centième près', () => {
    for (let mines = 1; mines < MINES_TILES; mines += 1) {
      for (let revealed = 1; revealed <= MINES_TILES - mines; revealed += 1) {
        const expected = survivalChance(mines, revealed) * (minesMultiplier(mines, revealed, 0.01) / 100);
        expect(expected).toBeLessThanOrEqual(0.99 + 1e-9);
        expect(expected).toBeGreaterThan(0.97);
      }
    }
  });

  it('suivent les valeurs attendues', () => {
    expect(minesMultiplier(1, 1, 0.01)).toBe(103);
    expect(minesMultiplier(24, 1, 0.01)).toBe(2_475);
    expect(minesMultiplier(3, 0, 0.01)).toBe(100);
    expect(nextDiamondChance(3, 0)).toBeCloseTo(22 / 25, 12);
    expect(formatMultiplier(245)).toBe('2,45');
  });
});

describe('MinesController', () => {
  it('débite la mise, cache les bombes dans la vue et fait grimper le multiplicateur', () => {
    const started = playing(run(session(), start(100, 3)));
    expect(started.player.bankroll).toBe(900);
    expect(started.round.mines).toHaveLength(3);
    const view = controller.project(started, alice);
    expect(view.round).not.toHaveProperty('mines');
    const [first = 0, second = 0] = safeTiles(started);
    const explored = playing(run(started, reveal(first), reveal(second)));
    expect(explored.round.multiplier).toBe(minesMultiplier(3, 2, 0.01));
  });

  it('perd la mise sur une bombe et dévoile toutes les bombes', () => {
    const started = playing(run(session(), start(100, 5)));
    const [mine = 0] = started.round.mines;
    const busted = unwrap(controller.apply(started, reveal(mine)));
    expect(busted.state.phase).toBe('IDLE');
    expect(busted.state.player.bankroll).toBe(900);
    if (busted.state.phase !== 'IDLE') return;
    expect(busted.state.lastRound).toMatchObject({ outcome: 'BUSTED', hitMine: mine, payout: 0, net: -100 });
    expect(busted.events.at(-1)).toMatchObject({ type: 'MINE_HIT', mines: started.round.mines });
  });

  it('encaisse mise × multiplicateur, et d’office quand tous les diamants sont trouvés', () => {
    const started = playing(run(session(), start(100, 1)));
    const [a = 0, b = 0] = safeTiles(started);
    const cashed = run(started, reveal(a), reveal(b), { type: 'CASH_OUT', playerId: alice });
    expect(cashed.player.bankroll).toBe(900 + Math.floor((100 * minesMultiplier(1, 2, 0.01)) / 100));

    const full = playing(run(session(), start(10, 24)));
    const [only = 0] = safeTiles(full);
    const auto = run(full, reveal(only));
    expect(auto.phase).toBe('IDLE');
    expect(auto.player.bankroll).toBe(990 + Math.floor((10 * 2_475) / 100));
  });

  it('refuse les actions invalides', () => {
    expectError(controller.apply(session(), start(10, 0)), 'ILLEGAL_ACTION');
    expectError(controller.apply(session(), start(10, 25)), 'ILLEGAL_ACTION');
    expectError(controller.apply(session(50), start(100, 3)), 'INSUFFICIENT_FUNDS');
    expectError(controller.apply(session(), reveal(0)), 'ILLEGAL_PHASE');
    const started = playing(run(session(), start(10, 3)));
    expectError(controller.apply(started, { type: 'CASH_OUT', playerId: alice }), 'ILLEGAL_ACTION');
    expectError(controller.apply(started, reveal(25)), 'ILLEGAL_ACTION');
    const [tile = 0] = safeTiles(started);
    expectError(controller.apply(run(started, reveal(tile)), reveal(tile)), 'ILLEGAL_ACTION');
    expectError(controller.apply(started, { type: 'CASH_OUT', playerId: playerId('bob') }), 'UNKNOWN_PLAYER');
  });

  it('tient une comptabilité exacte sur 2 000 parties au hasard', () => {
    const rng = new SeededRandomSource('mines-strategie');
    let state: MinesState = session(1_000_000);
    let expected = 1_000_000;
    for (let i = 0; i < 2_000; i += 1) {
      state = run(state, start(10, 1 + rng.nextInt(10)));
      const target = 1 + rng.nextInt(6);
      while (state.phase === 'PLAYING' && state.round.revealed.length < target) {
        const hidden = Array.from({ length: MINES_TILES }, (_, tile) => tile).filter((tile) => !playing(state).round.revealed.includes(tile));
        state = run(state, reveal(hidden[rng.nextInt(hidden.length)] ?? 0));
      }
      if (state.phase === 'PLAYING') state = run(state, { type: 'CASH_OUT', playerId: alice });
      if (state.phase !== 'IDLE' || state.lastRound === null) throw new Error('partie terminée attendue');
      expected += state.lastRound.net;
      expect(state.player.bankroll).toBe(expected);
    }
  });
});
