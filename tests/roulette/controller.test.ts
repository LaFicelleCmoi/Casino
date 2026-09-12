import { describe, expect, it } from 'vitest';
import { SeededRandomSource, chips, playerId, type RandomSource } from '../../src/core/index.js';
import {
  EUROPEAN_WHEEL_ORDER,
  RouletteController,
  RouletteWheel,
  STANDARD_ROULETTE_RULES,
  rouletteNumber,
  type BetSelection,
  type RouletteCommand,
  type RouletteRules,
  type RouletteState,
} from '../../src/roulette/index.js';
import { expectError, unwrap } from '../helpers.js';

const alice = playerId('alice');

/** Roue truquée pour les tests : la RandomSource désigne toujours la case du numéro voulu. */
function riggedTo(n: number): RandomSource {
  const pocketIndex = EUROPEAN_WHEEL_ORDER.indexOf(rouletteNumber(n));
  return { nextInt: () => pocketIndex };
}

function run(controller: RouletteController, state: RouletteState, ...commands: RouletteCommand[]): RouletteState {
  return commands.reduce<RouletteState>((current, command) => unwrap(controller.apply(current, command)).state, state);
}

function seated(controller: RouletteController, rules: RouletteRules = STANDARD_ROULETTE_RULES, buyIn = 1_000): RouletteState {
  return run(controller, unwrap(controller.createTable(rules)), {
    type: 'SIT_DOWN',
    playerId: alice,
    seatIndex: 0,
    displayName: 'Alice',
    buyIn: chips(buyIn),
  });
}

const placeBet = (bet: BetSelection, amount: number): RouletteCommand => ({
  type: 'PLACE_BET',
  playerId: alice,
  bet,
  amount: chips(amount),
});

const bankroll = (state: RouletteState): number => state.seats[0]?.bankroll ?? -1;

describe('tour complet', () => {
  it('paie le plein 17 et perd le Rouge quand le 17 noir sort', () => {
    const controller = new RouletteController(riggedTo(17));
    const state = run(
      controller,
      seated(controller),
      placeBet({ kind: 'RED' }, 10),
      placeBet({ kind: 'STRAIGHT', numbers: [17] }, 10),
      { type: 'CLOSE_BETS' },
      { type: 'SPIN' },
    );

    expect(state.phase).toBe('RESULT');
    if (state.phase !== 'RESULT') return;
    expect(state.outcome).toEqual({ number: 17, color: 'BLACK', parity: 'ODD', range: 'LOW', dozen: 2, column: 2 });
    expect(state.settlements).toHaveLength(1);
    expect(state.settlements[0]).toMatchObject({ totalStaked: 20, totalReturned: 360, net: 340, bankrollAfter: 1_340 });
    expect(bankroll(state)).toBe(1_340);
    expect(state.seats[0]?.bets).toEqual([]);
    expect(state.history).toEqual([17]);
    expect(state.roundNumber).toBe(1);
  });

  it('applique la règle du zéro : externes perdues, plein 0 payé', () => {
    const controller = new RouletteController(riggedTo(0));
    const state = run(
      controller,
      seated(controller),
      placeBet({ kind: 'RED' }, 100),
      placeBet({ kind: 'DOZEN', index: 1 }, 100),
      placeBet({ kind: 'STRAIGHT', numbers: [0] }, 10),
      { type: 'CLOSE_BETS' },
      { type: 'SPIN' },
    );
    expect(bankroll(state)).toBe(1_000 - 210 + 360);
  });

  it("rouvre les mises au tour suivant en conservant l'historique", () => {
    const controller = new RouletteController(riggedTo(32));
    const spinOnce = (state: RouletteState): RouletteState =>
      run(controller, state, placeBet({ kind: 'RED' }, 10), { type: 'CLOSE_BETS' }, { type: 'SPIN' });

    const first = spinOnce(seated(controller));
    const reopened = run(controller, first, { type: 'NEXT_ROUND' });
    expect(reopened.phase).toBe('BETTING');
    expect(spinOnce(reopened).history).toEqual([32, 32]);
  });
});

describe('state machine', () => {
  const controller = new RouletteController(riggedTo(5));

  it('refuse toute mise après « Rien ne va plus »', () => {
    const closed = run(controller, seated(controller), { type: 'CLOSE_BETS' });
    expectError(controller.apply(closed, placeBet({ kind: 'RED' }, 10)), 'ILLEGAL_PHASE');
    expect(controller.legalActions(closed, alice).actions).toEqual([]);
  });

  it('ne lance la roue qu’une fois les mises closes', () => {
    expectError(controller.apply(seated(controller), { type: 'SPIN' }), 'ILLEGAL_PHASE');
    expectError(controller.apply(seated(controller), { type: 'NEXT_ROUND' }), 'ILLEGAL_PHASE');
  });

  it('refuse un joueur qui n’est pas assis', () => {
    const command: RouletteCommand = { type: 'PLACE_BET', playerId: playerId('bob'), bet: { kind: 'RED' }, amount: chips(10) };
    expectError(controller.apply(seated(controller), command), 'UNKNOWN_PLAYER');
  });

  it('rejette des règles de table invalides', () => {
    expectError(controller.createTable({ ...STANDARD_ROULETTE_RULES, seatCount: 0 }), 'INVALID_RULES');
    expectError(controller.createTable({ ...STANDARD_ROULETTE_RULES, maxTotalBet: chips(10) }), 'INVALID_RULES');
  });
});

describe('moteur de mises', () => {
  const controller = new RouletteController(riggedTo(1));

  it('débite les jetons dès la pose et cumule ceux d’une même position', () => {
    const state = run(controller, seated(controller), placeBet({ kind: 'RED' }, 50), placeBet({ kind: 'RED' }, 25));
    expect(bankroll(state)).toBe(925);
    expect(state.seats[0]?.bets).toEqual([{ betId: 'RED', amount: 75 }]);
    expect(controller.legalActions(state, alice).actions).toEqual(['LEAVE_SEAT', 'PLACE_BET', 'REMOVE_BET', 'CLEAR_BETS']);
  });

  it('rembourse au retrait d’une position et à l’effacement du tapis', () => {
    const redId = unwrap(controller.catalog.resolve({ kind: 'RED' })).id;
    const placed = run(controller, seated(controller), placeBet({ kind: 'RED' }, 50), placeBet({ kind: 'ODD' }, 30));
    const removed = run(controller, placed, { type: 'REMOVE_BET', playerId: alice, betId: redId });
    expect(bankroll(removed)).toBe(970);
    expect(bankroll(run(controller, removed, { type: 'CLEAR_BETS', playerId: alice }))).toBe(1_000);
    expectError(controller.apply(removed, { type: 'REMOVE_BET', playerId: alice, betId: redId }), 'ILLEGAL_ACTION');
  });

  it('valide les montants, le solde et les plafonds de table', () => {
    const rules: RouletteRules = { ...STANDARD_ROULETTE_RULES, minBet: chips(5), maxBetPerPosition: chips(100), maxTotalBet: chips(150) };
    const table = seated(controller, rules);
    expectError(controller.apply(table, placeBet({ kind: 'RED' }, 0)), 'INVALID_AMOUNT');
    expectError(controller.apply(table, placeBet({ kind: 'RED' }, 4)), 'BET_OUT_OF_LIMITS');
    expectError(controller.apply(table, placeBet({ kind: 'RED' }, 101)), 'BET_OUT_OF_LIMITS');

    const hundredOnRed = run(controller, table, placeBet({ kind: 'RED' }, 100));
    expectError(controller.apply(hundredOnRed, placeBet({ kind: 'RED' }, 5)), 'BET_OUT_OF_LIMITS');
    expectError(controller.apply(hundredOnRed, placeBet({ kind: 'BLACK' }, 60)), 'BET_OUT_OF_LIMITS');

    expectError(controller.apply(seated(controller, rules, 20), placeBet({ kind: 'RED' }, 30)), 'INSUFFICIENT_FUNDS');
  });

  it('refuse une position absente du tapis', () => {
    expectError(controller.apply(seated(controller), placeBet({ kind: 'SPLIT', numbers: [1, 5] }, 10)), 'INVALID_BET');
  });

  it('rend les jetons posés au joueur qui quitte la table', () => {
    const placed = run(controller, seated(controller), placeBet({ kind: 'RED' }, 200));
    const left = unwrap(controller.apply(placed, { type: 'LEAVE_SEAT', playerId: alice }));
    expect(left.events).toEqual([{ type: 'PLAYER_LEFT', seatIndex: 0, playerId: alice, bankroll: 1_000 }]);
    expect(left.state.seats[0]).toBeNull();
  });
});

describe('RNG de la roue', () => {
  it('tire les 37 cases de manière uniforme', () => {
    const wheel = new RouletteWheel(new SeededRandomSource('roulette-uniformity'));
    const counts = new Map<number, number>();
    for (let i = 0; i < 37_000; i += 1) {
      const { number } = wheel.spin();
      counts.set(number, (counts.get(number) ?? 0) + 1);
    }
    expect(counts.size).toBe(37);
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1_150);
    }
  });

  it('associe la case tirée au numéro correspondant du cylindre', () => {
    expect(new RouletteWheel({ nextInt: () => 1 }).spin()).toEqual({ pocketIndex: 1, number: 32 });
  });
});
