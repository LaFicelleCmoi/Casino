import { describe, expect, it } from 'vitest';
import { card, chips, type SeatIndex } from '../../src/core/index.js';
import {
  awardPots,
  buildPots,
  contributionsOf,
  returnUncalledBet,
  splitPot,
  type EvaluatedHand,
  type PotContribution,
} from '../../src/holdem/index.js';
import { pokerSeat } from './fixtures.js';

function contribution(
  seatIndex: SeatIndex,
  amount: number,
  flags: { folded?: boolean; allIn?: boolean } = {},
): PotContribution {
  return { seatIndex, amount: chips(amount), folded: flags.folded ?? false, allIn: flags.allIn ?? false };
}

const ace = card('A', 'spades');
const evaluated = (score: number): EvaluatedHand => ({
  category: 'HIGH_CARD',
  tiebreakers: [],
  bestFive: [ace, ace, ace, ace, ace],
  score,
});

// Scénario documenté dans src/holdem/types/pot.ts
const multiAllIn = [
  contribution(0, 50, { allIn: true }),
  contribution(1, 120, { allIn: true }),
  contribution(2, 200),
  contribution(3, 200, { folded: true }),
];

describe('buildPots', () => {
  it('construit le pot principal et les side pots d’un multi-all-in', () => {
    expect(buildPots(multiAllIn)).toEqual([
      { amount: 200, eligibleSeats: [0, 1, 2] },
      { amount: 210, eligibleSeats: [1, 2] },
      { amount: 160, eligibleSeats: [2] },
    ]);
  });

  it('conserve exactement la somme des contributions', () => {
    const total = buildPots(multiAllIn).reduce((sum, pot) => sum + pot.amount, 0);
    expect(total).toBe(570);
  });

  it('regroupe deux all-in de même montant sur un seul palier', () => {
    expect(
      buildPots([
        contribution(0, 100, { allIn: true }),
        contribution(1, 100, { allIn: true }),
        contribution(2, 300),
        contribution(3, 300),
      ]),
    ).toEqual([
      { amount: 400, eligibleSeats: [0, 1, 2, 3] },
      { amount: 400, eligibleSeats: [2, 3] },
    ]);
  });

  it('verse au dernier pot l’argent mort d’un joueur foldé', () => {
    expect(buildPots([contribution(0, 100), contribution(1, 150, { folded: true })])).toEqual([
      { amount: 250, eligibleSeats: [0] },
    ]);
  });

  it('ne crée aucun pot sans contribution', () => {
    expect(buildPots([])).toEqual([]);
  });

  it('extrait les contributions des sièges occupés', () => {
    const seats = [
      pokerSeat(0, { totalCommitted: chips(50), status: 'ALL_IN' }),
      null,
      pokerSeat(2, { totalCommitted: chips(0) }),
      pokerSeat(3, { totalCommitted: chips(80), status: 'FOLDED' }),
    ];
    expect(contributionsOf(seats)).toEqual([
      contribution(0, 50, { allIn: true }),
      contribution(3, 80, { folded: true }),
    ]);
  });
});

describe('returnUncalledBet', () => {
  it('rend la part non suivie à son auteur', () => {
    const allIn = pokerSeat(1, { stack: chips(0), streetBet: chips(100), totalCommitted: chips(100), status: 'ALL_IN' });
    const seats = [pokerSeat(0, { stack: chips(700), streetBet: chips(300), totalCommitted: chips(300) }), allIn, null];

    const result = returnUncalledBet(seats);
    expect(result.returned).toEqual({ seatIndex: 0, amount: 200 });
    expect(result.seats[0]).toMatchObject({ stack: 900, streetBet: 100, totalCommitted: 100 });
    expect(result.seats[1]).toBe(allIn);
    expect(result.seats[2]).toBeNull();
  });

  it('rend sa big blind excédentaire quand tout le monde se couche', () => {
    const seats = [
      pokerSeat(0, { streetBet: chips(5), totalCommitted: chips(5), status: 'FOLDED' }),
      pokerSeat(1, { streetBet: chips(10), totalCommitted: chips(10) }),
    ];
    expect(returnUncalledBet(seats).returned).toEqual({ seatIndex: 1, amount: 5 });
  });

  it('ne rend rien quand les mises sont égalisées', () => {
    const seats = [pokerSeat(0, { streetBet: chips(50) }), pokerSeat(1, { streetBet: chips(50) })];
    expect(returnUncalledBet(seats).returned).toBeNull();
  });
});

describe('répartition des pots', () => {
  it('attribue chaque pot à la meilleure main parmi ses éligibles', () => {
    const hands = new Map<SeatIndex, EvaluatedHand>([
      [0, evaluated(900)],
      [1, evaluated(500)],
      [2, evaluated(500)],
    ]);
    const awards = awardPots(buildPots(multiAllIn), hands, [1, 2, 3, 0]);

    expect(awards.map((award) => award.shares)).toEqual([
      [{ seatIndex: 0, amount: 200 }],
      [
        { seatIndex: 1, amount: 105 },
        { seatIndex: 2, amount: 105 },
      ],
      [{ seatIndex: 2, amount: 160 }],
    ]);
    expect(awards[0]?.winningHand?.score).toBe(900);
  });

  it('donne le jeton indivisible au premier gagnant à gauche du bouton', () => {
    const hands = new Map<SeatIndex, EvaluatedHand>([
      [1, evaluated(700)],
      [2, evaluated(700)],
    ]);
    const [award] = awardPots([{ amount: chips(211), eligibleSeats: [2, 1] }], hands, [1, 2]);
    expect(award?.shares).toEqual([
      { seatIndex: 1, amount: 106 },
      { seatIndex: 2, amount: 105 },
    ]);
  });

  it('attribue un pot non contesté sans showdown', () => {
    const [award] = awardPots([{ amount: chips(30), eligibleSeats: [4] }], new Map(), [4]);
    expect(award).toMatchObject({ winningHand: null, shares: [{ seatIndex: 4, amount: 30 }] });
  });

  it('distribue les jetons indivisibles un par un dans l’ordre de priorité', () => {
    expect(splitPot(chips(101), [5, 1, 3])).toEqual([
      { seatIndex: 5, amount: 34 },
      { seatIndex: 1, amount: 34 },
      { seatIndex: 3, amount: 33 },
    ]);
  });
});
