import { describe, expect, it } from 'vitest';
import { SeededRandomSource, cardCode, chips, playerId } from '../../src/core/index.js';
import {
  BlackjackController,
  STANDARD_BLACKJACK_RULES,
  type BlackjackCommand,
  type BlackjackState,
} from '../../src/blackjack/index.js';
import { cards, expectError, unwrap } from '../helpers.js';

const controller = new BlackjackController(new SeededRandomSource('blackjack-controller'));
const alice = playerId('alice');
const bob = playerId('bob');

function run(state: BlackjackState, ...commands: BlackjackCommand[]): BlackjackState {
  return commands.reduce<BlackjackState>((current, command) => unwrap(controller.apply(current, command)).state, state);
}

/** Remplace le sabot par un ordre de cartes choisi : ordre de donne = joueur, croupier (visible), joueur, hole card. */
function stackShoe(state: BlackjackState, notation: string): BlackjackState {
  const stacked = cards(notation);
  return { ...state, shoe: { deckCount: 1, cards: stacked, nextIndex: 0, roundStartIndex: 0, cutCardIndex: stacked.length } };
}

function aliceBets(amount = 100): BlackjackState {
  return run(
    unwrap(controller.createTable(STANDARD_BLACKJACK_RULES)),
    { type: 'SIT_DOWN', playerId: alice, seatIndex: 0, displayName: 'Alice', buyIn: chips(500) },
    { type: 'PLACE_BET', playerId: alice, amount: chips(amount) },
  );
}

describe('state machine', () => {
  it('verrouille les actions selon la phase', () => {
    expectError(controller.apply(aliceBets(), { type: 'HIT', playerId: alice }), 'ILLEGAL_PHASE');
    expectError(controller.apply(aliceBets(), { type: 'NEXT_ROUND' }), 'ILLEGAL_PHASE');
  });

  it('refuse de distribuer sans mise', () => {
    const empty = unwrap(controller.createTable(STANDARD_BLACKJACK_RULES));
    expectError(controller.apply(empty, { type: 'DEAL' }), 'NOT_ENOUGH_PLAYERS');
  });

  it('refuse une action hors de son tour', () => {
    const twoPlayers = run(
      aliceBets(),
      { type: 'SIT_DOWN', playerId: bob, seatIndex: 1, displayName: 'Bob', buyIn: chips(500) },
      { type: 'PLACE_BET', playerId: bob, amount: chips(50) },
    );
    const dealt = run(stackShoe(twoPlayers, '2c 3c 4c 5c 6c 7c 8c 9c'), { type: 'DEAL' });
    expectError(controller.apply(dealt, { type: 'HIT', playerId: bob }), 'NOT_YOUR_TURN');
  });

  it('interdit le Double Down après une troisième carte', () => {
    const afterHit = run(stackShoe(aliceBets(), '2c 3c 4c 5c 6c 7c 8c 9c'), { type: 'DEAL' }, { type: 'HIT', playerId: alice });
    expect(controller.legalActions(afterHit, alice).actions).toEqual(['HIT', 'STAND']);
    expectError(controller.apply(afterHit, { type: 'DOUBLE_DOWN', playerId: alice }), 'ILLEGAL_ACTION');
  });
});

describe('manches complètes', () => {
  it('joue une main, fait tirer le croupier jusqu’au bust et paie 1:1', () => {
    const dealt = run(stackShoe(aliceBets(), '2c 3c 4c 5c 6c 7c 8c 9c'), { type: 'DEAL' });
    expect(controller.legalActions(dealt, alice).actions).toEqual(['HIT', 'STAND', 'DOUBLE_DOWN']);

    // Alice : 2 + 4 + 6 + 7 = 19. Croupier : 3 + 5 + 8 + 9 = 25.
    const over = run(dealt, { type: 'HIT', playerId: alice }, { type: 'HIT', playerId: alice }, { type: 'STAND', playerId: alice });
    expect(over).toMatchObject({ phase: 'ROUND_OVER', settlements: [{ outcome: 'WIN', returned: 200 }] });
    expect(over.seats[0]?.bankroll).toBe(600);
    expect(over.dealer.cards.map(cardCode)).toEqual(['3c', '5c', '8c', '9c']);
  });

  it('paie un Blackjack naturel 3:2 sans faire tirer le croupier', () => {
    const over = run(stackShoe(aliceBets(), 'As 5d Kh 9c 2c 2d'), { type: 'DEAL' });
    expect(over).toMatchObject({ phase: 'ROUND_OVER', settlements: [{ outcome: 'BLACKJACK', returned: 250 }] });
    expect(over.dealer.cards).toHaveLength(2);
    expect(over.seats[0]?.bankroll).toBe(650);
  });

  it('crée deux mains parallèles au split et règle chacune avec sa propre mise', () => {
    // Paire de 8 contre 5 + T. Main 1 : 8 + 3 puis double (T) = 21. Main 2 : 8 + 9 = 17. Croupier : 15 + 7 = 22.
    const dealt = run(stackShoe(aliceBets(), '8s 5d 8h Tc 3d 9c Ts 7h 2c 2d'), { type: 'DEAL' });
    expect(controller.legalActions(dealt, alice).actions).toContain('SPLIT');

    const split = run(dealt, { type: 'SPLIT', playerId: alice });
    expect(split.seats[0]?.hands.map((hand) => hand.cards.map(cardCode))).toEqual([['8s', '3d'], ['8h', '9c']]);
    expect(split.seats[0]?.bankroll).toBe(300);
    expect(split).toMatchObject({ phase: 'PLAYER_TURNS', cursor: { seatIndex: 0, handIndex: 0 } });

    const doubled = run(split, { type: 'DOUBLE_DOWN', playerId: alice });
    expect(doubled).toMatchObject({ phase: 'PLAYER_TURNS', cursor: { seatIndex: 0, handIndex: 1 } });

    const over = run(doubled, { type: 'STAND', playerId: alice });
    expect(over).toMatchObject({
      phase: 'ROUND_OVER',
      settlements: [
        { outcome: 'WIN', stake: 200, returned: 400 },
        { outcome: 'WIN', stake: 100, returned: 200 },
      ],
    });
    expect(over.seats[0]?.bankroll).toBe(800);
  });

  it('propose l’assurance sur un As et la paie 2:1 quand le croupier a Blackjack', () => {
    const offered = run(stackShoe(aliceBets(), 'Ts As 9c Kd 2c 2d'), { type: 'DEAL' });
    expect(offered.phase).toBe('INSURANCE');

    const over = run(offered, { type: 'TAKE_INSURANCE', playerId: alice });
    expect(over).toMatchObject({
      phase: 'ROUND_OVER',
      dealerHadBlackjack: true,
      settlements: [{ outcome: 'LOSS' }],
      insuranceSettlements: [{ stake: 50, returned: 150 }],
    });
    expect(over.seats[0]?.bankroll).toBe(500);
  });
});

describe('plusieurs mains', () => {
  it('distribue une main par case, les joue dans l’ordre et règle chacune', () => {
    const twoBoxes = run(aliceBets(), { type: 'PLACE_BET', playerId: alice, amount: chips(100), box: 1 });
    expect(twoBoxes.seats[0]?.pendingBets).toEqual([100, 100]);
    expect(twoBoxes.seats[0]?.bankroll).toBe(300);

    // Ordre de donne : case 1, case 2, croupier visible, case 1, case 2, hole card.
    // Case 1 : T + 9 = 19. Case 2 : 5 + 6 = 11. Croupier : 7 + T = 17, il reste.
    const dealt = run(stackShoe(twoBoxes, 'Tc 5d 7h 9s 6c Td 2c 2d'), { type: 'DEAL' });
    expect(dealt).toMatchObject({ phase: 'PLAYER_TURNS', cursor: { seatIndex: 0, handIndex: 0 } });
    expect(dealt.seats[0]?.hands.map((hand) => [hand.box, hand.cards.map(cardCode)])).toEqual([
      [0, ['Tc', '9s']],
      [1, ['5d', '6c']],
    ]);

    const over = run(dealt, { type: 'STAND', playerId: alice }, { type: 'STAND', playerId: alice });
    expect(over).toMatchObject({
      phase: 'ROUND_OVER',
      settlements: [
        { outcome: 'WIN', returned: 200 },
        { outcome: 'LOSS', returned: 0 },
      ],
    });
    expect(over.seats[0]?.bankroll).toBe(500);
  });

  it('n’ouvre une case de plus que s’il reste une place libre', () => {
    const full = run(
      unwrap(controller.createTable({ ...STANDARD_BLACKJACK_RULES, seatCount: 2 })),
      { type: 'SIT_DOWN', playerId: alice, seatIndex: 0, displayName: 'Alice', buyIn: chips(500) },
      { type: 'PLACE_BET', playerId: alice, amount: chips(10) },
      { type: 'PLACE_BET', playerId: alice, amount: chips(10), box: 1 },
    );
    const view = controller.project(full, alice);
    expect(view.freePlaces).toBe(0);
    expect(view.legalActions.boxRanges).toEqual([
      { min: 1, max: 480 },
      { min: 1, max: 480 },
      null,
    ]);
    expectError(controller.apply(full, { type: 'PLACE_BET', playerId: alice, amount: chips(10), box: 2 }), 'ILLEGAL_ACTION');
    expectError(
      controller.apply(full, { type: 'SIT_DOWN', playerId: bob, seatIndex: 1, displayName: 'Bob', buyIn: chips(500) }),
      'SEAT_TAKEN',
    );
    expect(controller.legalActions(full, bob).actions).toEqual([]);
  });

  it('assure toutes les mains d’un coup quand le croupier montre un As', () => {
    const twoBoxes = run(aliceBets(), { type: 'PLACE_BET', playerId: alice, amount: chips(50), box: 1 });
    // Case 1 : T + K. Case 2 : 9 + 8. Croupier : As + K = Blackjack.
    const offered = run(stackShoe(twoBoxes, 'Ts 9h As Kd 8c Kc 2c 2d'), { type: 'DEAL' });
    expect(offered.phase).toBe('INSURANCE');

    const over = run(offered, { type: 'TAKE_INSURANCE', playerId: alice });
    expect(over).toMatchObject({ phase: 'ROUND_OVER', insuranceSettlements: [{ stake: 75, returned: 225 }] });
    expect(controller.project(over, alice).insuranceSettlements).toEqual([{ seatIndex: 0, stake: 75, returned: 225 }]);
    expect(over.seats[0]?.bankroll).toBe(500);
  });
});

describe('croupier humain', () => {
  function manualBets(): BlackjackState {
    return run(
      unwrap(controller.createTable({ ...STANDARD_BLACKJACK_RULES, dealerPlay: 'MANUAL' })),
      { type: 'SIT_DOWN', playerId: alice, seatIndex: 0, displayName: 'Alice', buyIn: chips(500) },
      { type: 'PLACE_BET', playerId: alice, amount: chips(100) },
    );
  }

  it('retourne sa carte puis tire tant que les règles l’exigent, avant de payer', () => {
    // Alice : T + 9 = 19. Croupier : 5 + 6 = 11, tire 4 (15) puis 8 (23, bust).
    const dealt = run(stackShoe(manualBets(), 'Tc 5d 9s 6c 4h 8d 2c 2d'), { type: 'DEAL' }, { type: 'STAND', playerId: alice });
    expect(dealt.phase).toBe('DEALER_TURN');
    expect(controller.dealerActions(dealt)).toEqual(['REVEAL_HOLE_CARD']);
    expect(controller.project(dealt, alice).dealerCards[1]).toEqual({ faceUp: false });
    expectError(controller.apply(dealt, { type: 'DEALER_STAND' }), 'ILLEGAL_ACTION');

    const revealed = run(dealt, { type: 'REVEAL_HOLE_CARD' });
    expect(controller.project(revealed, alice).dealerActions).toEqual(['DEALER_HIT']);
    expectError(controller.apply(revealed, { type: 'DEALER_STAND' }), 'ILLEGAL_ACTION');

    const drawn = run(revealed, { type: 'DEALER_HIT' }, { type: 'DEALER_HIT' });
    expect(drawn.dealer.cards.map(cardCode)).toEqual(['5d', '6c', '4h', '8d']);
    expect(controller.dealerActions(drawn)).toEqual(['DEALER_STAND']);
    expectError(controller.apply(drawn, { type: 'DEALER_HIT' }), 'ILLEGAL_ACTION');

    const over = run(drawn, { type: 'DEALER_STAND' });
    expect(over).toMatchObject({ phase: 'ROUND_OVER', settlements: [{ outcome: 'WIN', returned: 200 }] });
    expect(over.seats[0]?.bankroll).toBe(600);
  });

  it('s’arrête sans tirer quand plus aucune main n’est à battre', () => {
    // Alice : T + 6 puis K = bust. Croupier : 5 + 6 = 11, mais rien à battre.
    const busted = run(stackShoe(manualBets(), 'Tc 5d 6s 6c Kh 2c 2d'), { type: 'DEAL' }, { type: 'HIT', playerId: alice });
    const revealed = run(busted, { type: 'REVEAL_HOLE_CARD' });
    expect(controller.dealerActions(revealed)).toEqual(['DEALER_STAND']);
    expect(run(revealed, { type: 'DEALER_STAND' })).toMatchObject({ phase: 'ROUND_OVER', settlements: [{ outcome: 'LOSS' }] });
  });
});

describe('projection anti-triche', () => {
  it('masque la hole card et l’ordre du sabot', () => {
    const dealt = run(stackShoe(aliceBets(), '2c 3c 4c 5c 6c 7c 8c 9c'), { type: 'DEAL' });
    const view = controller.project(dealt, alice);
    expect(view.dealerCards[1]).toEqual({ faceUp: false });
    expect(view.dealerScore?.total).toBe(3);
    expect(Object.keys(view.shoe)).toEqual(['cardsRemaining', 'reshufflePending']);
    expect(JSON.stringify(view.dealerCards)).not.toContain('"rank":"5"');
    expect(view.legalActions.actions).toContain('HIT');
  });

  it('masque la hole card dans le flux d’événements', () => {
    const events = unwrap(controller.apply(stackShoe(aliceBets(), '2c 3c 4c 5c 6c 7c 8c 9c'), { type: 'DEAL' })).events;
    const holeCard = events.find((event) => event.type === 'CARD_DEALT' && !event.faceUp);
    expect(holeCard).toBeDefined();
    if (holeCard !== undefined) {
      expect(controller.projectEvent(holeCard, alice)).toMatchObject({ card: { faceUp: false } });
    }
  });
});

describe('robustesse', () => {
  const simpleActions = ['TAKE_INSURANCE', 'DECLINE_INSURANCE', 'HIT', 'STAND', 'DOUBLE_DOWN', 'SPLIT', 'SURRENDER'] as const;
  type SimpleAction = (typeof simpleActions)[number];
  const isSimpleAction = (type: string): type is SimpleAction => (simpleActions as readonly string[]).includes(type);

  it('enchaîne 200 manches aléatoires à 3 joueurs sans erreur', () => {
    const rng = new SeededRandomSource('blackjack-fuzz');
    const players = ['a', 'b', 'c'].map((id) => playerId(id));
    let state = run(
      unwrap(controller.createTable({ ...STANDARD_BLACKJACK_RULES, surrender: 'LATE' })),
      ...players.map((id, seatIndex): BlackjackCommand => ({ type: 'SIT_DOWN', playerId: id, seatIndex, displayName: id, buyIn: chips(5_000) })),
    );

    let rounds = 0;
    for (; rounds < 200; rounds += 1) {
      for (const id of players) {
        const { betRange } = controller.legalActions(state, id);
        if (betRange !== null) state = run(state, { type: 'PLACE_BET', playerId: id, amount: betRange.min });
      }
      const dealt = controller.apply(state, { type: 'DEAL' });
      if (!dealt.ok) break;
      state = dealt.value.state;

      for (let guard = 0; state.phase !== 'ROUND_OVER'; guard += 1) {
        if (guard > 100) throw new Error('Manche sans fin');
        const current = state;
        const actor = players.find((id) => controller.legalActions(current, id).actions.length > 0);
        if (actor === undefined) throw new Error(`Aucun joueur ne peut agir en phase ${state.phase}`);
        const { actions } = controller.legalActions(state, actor);
        const type = actions[rng.nextInt(actions.length)];
        if (type === undefined || !isSimpleAction(type)) throw new Error(`Action inattendue : ${type}`);
        state = run(state, { type, playerId: actor });
      }
      state = run(state, { type: 'NEXT_ROUND' });
    }
    expect(rounds).toBeGreaterThan(50);
  });
});
