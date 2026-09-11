import { describe, expect, it } from 'vitest';
import { SeededRandomSource, chips, playerId, type PlayerId, type RandomSource } from '../../src/core/index.js';
import {
  HoldemController,
  STANDARD_HOLDEM_RULES,
  isHandInProgress,
  type HoldemCommand,
  type HoldemState,
  type PokerBettingAction,
  type PokerLegalActions,
} from '../../src/holdem/index.js';
import { expectError, unwrap } from '../helpers.js';

const controller = new HoldemController(new SeededRandomSource('holdem-controller'));
const rules = { ...STANDARD_HOLDEM_RULES, seatCount: 6 };
const p = (index: number): PlayerId => playerId(`p${index}`);

function run(state: HoldemState, ...commands: HoldemCommand[]): HoldemState {
  return commands.reduce<HoldemState>((current, command) => unwrap(controller.apply(current, command)).state, state);
}

function tableWith(stacks: Record<number, number>): HoldemState {
  return run(
    unwrap(controller.createTable(rules)),
    ...Object.entries(stacks).map(
      ([seat, buyIn]): HoldemCommand => ({
        type: 'SIT_DOWN',
        playerId: p(Number(seat)),
        seatIndex: Number(seat),
        displayName: `Joueur ${seat}`,
        buyIn: chips(buyIn),
      }),
    ),
  );
}

/** Jetons devant les joueurs + jetons engagés dans la main en cours : doit rester constant. */
function totalChips(state: HoldemState): number {
  return state.seats.reduce(
    (sum, seat) => (seat === null ? sum : sum + seat.stack + (state.phase === 'HAND_COMPLETE' ? 0 : seat.totalCommitted)),
    0,
  );
}

describe('début de main', () => {
  it('exige au moins deux joueurs', () => {
    expectError(controller.apply(tableWith({ 0: 1_000 }), { type: 'START_HAND' }), 'NOT_ENOUGH_PLAYERS');
  });

  it('place bouton et blindes, puis donne la parole à gauche de la big blind', () => {
    const state = run(tableWith({ 0: 1_000, 1: 1_000, 2: 1_000 }), { type: 'START_HAND' });
    expect(state).toMatchObject({ phase: 'PREFLOP', buttonSeat: 0, blinds: { smallBlind: 1, bigBlind: 2 }, betting: { toAct: 0 } });
    expect(state.seats.map((seat) => seat?.streetBet)).toEqual([0, 5, 10, undefined, undefined, undefined]);
    expect(state.seats.every((seat) => seat === null || seat.holeCards !== null)).toBe(true);
  });

  it('heads-up : le bouton poste la small blind et parle en premier préflop', () => {
    const state = run(tableWith({ 0: 1_000, 3: 1_000 }), { type: 'START_HAND' });
    expect(state).toMatchObject({ buttonSeat: 0, blinds: { smallBlind: 0, bigBlind: 3 }, betting: { toAct: 0 } });
  });

  it('refuse une mise hors d’une main et hors de son tour', () => {
    const waiting = tableWith({ 0: 1_000, 1: 1_000 });
    expectError(controller.apply(waiting, { type: 'CALL', playerId: p(0) }), 'ILLEGAL_PHASE');
    const started = run(waiting, { type: 'START_HAND' });
    expectError(controller.apply(started, { type: 'CALL', playerId: p(1) }), 'NOT_YOUR_TURN');
  });
});

describe('déroulement', () => {
  it('attribue le pot à la big blind quand tout le monde se couche', () => {
    const state = run(
      tableWith({ 0: 1_000, 1: 1_000, 2: 1_000 }),
      { type: 'START_HAND' },
      { type: 'FOLD', playerId: p(0) },
      { type: 'FOLD', playerId: p(1) },
    );
    expect(state).toMatchObject({ phase: 'HAND_COMPLETE', outcome: { kind: 'UNCONTESTED', winner: 2 } });
    expect(state.seats.map((seat) => seat?.stack)).toEqual([1_000, 995, 1_005, undefined, undefined, undefined]);
  });

  it('donne son option à la big blind puis passe au flop', () => {
    const limped = run(
      tableWith({ 0: 1_000, 1: 1_000, 2: 1_000 }),
      { type: 'START_HAND' },
      { type: 'CALL', playerId: p(0) },
      { type: 'CALL', playerId: p(1) },
    );
    expect(limped).toMatchObject({ phase: 'PREFLOP', betting: { toAct: 2 } });

    const flop = run(limped, { type: 'CHECK', playerId: p(2) });
    expect(flop).toMatchObject({ phase: 'FLOP', betting: { toAct: 1, currentBet: 0 } });
    expect(flop.phase === 'FLOP' && flop.board).toHaveLength(3);
  });

  it('gère un multi-all-in : board déroulé, side pots et conservation des jetons', () => {
    const state = run(
      tableWith({ 0: 200, 1: 500, 2: 1_000 }),
      { type: 'START_HAND' },
      { type: 'ALL_IN', playerId: p(0) },
      { type: 'ALL_IN', playerId: p(1) },
      { type: 'CALL', playerId: p(2) },
    );
    expect(state.phase).toBe('HAND_COMPLETE');
    if (state.phase !== 'HAND_COMPLETE') return;

    expect(state.board).toHaveLength(5);
    expect(state.outcome.kind).toBe('SHOWDOWN');
    expect(state.outcome.awards.map((award) => award.amount)).toEqual([600, 600]);
    expect(totalChips(state)).toBe(1_700);
  });
});

describe('projection anti-triche', () => {
  it('ne montre à un joueur que ses propres cartes', () => {
    const started = run(tableWith({ 0: 1_000, 1: 1_000 }), { type: 'START_HAND' });
    const view = controller.project(started, p(0));
    expect(view.seats[0]?.holeCards?.every((card) => card.faceUp)).toBe(true);
    expect(view.seats[1]?.holeCards).toEqual([{ faceUp: false }, { faceUp: false }]);
    expect(JSON.stringify(view)).not.toContain('deck');
  });

  it('masque les cartes privées dans le flux d’événements', () => {
    const { events } = unwrap(controller.apply(tableWith({ 0: 1_000, 1: 1_000 }), { type: 'START_HAND' }));
    const opponentCards = events.find((event) => event.type === 'HOLE_CARDS_DEALT' && event.playerId === p(1));
    expect(opponentCards).toBeDefined();
    if (opponentCards !== undefined) {
      expect(controller.projectEvent(opponentCards, p(0))).toMatchObject({ cards: [{ faceUp: false }, { faceUp: false }] });
      expect(controller.projectEvent(opponentCards, p(1))).toMatchObject({ cards: [{ faceUp: true }, { faceUp: true }] });
    }
  });
});

function randomAction(legal: PokerLegalActions, id: PlayerId, rng: RandomSource): PokerBettingAction {
  const options: PokerBettingAction[] = [];
  if (legal.canCheck) options.push({ type: 'CHECK', playerId: id });
  if (legal.callAmount !== null) options.push({ type: 'CALL', playerId: id }, { type: 'CALL', playerId: id });
  if (legal.bet !== null) options.push({ type: 'BET', playerId: id, amount: legal.bet.min });
  if (legal.raise !== null) options.push({ type: 'RAISE', playerId: id, raiseTo: legal.raise.min });
  if (legal.allInAmount !== null && rng.nextInt(8) === 0) options.push({ type: 'ALL_IN', playerId: id });
  if (!legal.canCheck) options.push({ type: 'FOLD', playerId: id });
  return options[rng.nextInt(options.length)] ?? { type: 'FOLD', playerId: id };
}

describe('robustesse', () => {
  it('conserve les jetons sur 300 mains jouées au hasard', () => {
    const rng = new SeededRandomSource('holdem-fuzz');
    let state = tableWith({ 0: 1_000, 1: 1_000, 2: 1_000, 4: 1_000 });

    let hands = 0;
    for (; hands < 300; hands += 1) {
      const started = controller.apply(state, { type: 'START_HAND' });
      if (!started.ok) {
        expect(started.error.code).toBe('NOT_ENOUGH_PLAYERS');
        break;
      }
      state = started.value.state;

      for (let guard = 0; isHandInProgress(state); guard += 1) {
        if (guard > 200) throw new Error('Main sans fin');
        const actor = state.seats[state.betting.toAct];
        if (actor === null || actor === undefined) throw new Error('Le joueur à parler est absent');
        const legal = controller.legalActions(state, actor.player.id);
        if (legal === null) throw new Error(`Aucune action légale pour le siège ${actor.seatIndex}`);
        state = unwrap(controller.apply(state, randomAction(legal, actor.player.id, rng))).state;
        expect(totalChips(state)).toBe(4_000);
      }
      expect(state.phase).toBe('HAND_COMPLETE');
    }
    expect(hands).toBeGreaterThan(10);
  });
});
