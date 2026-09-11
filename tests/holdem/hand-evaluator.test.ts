import { describe, expect, it } from 'vitest';
import { cardCode } from '../../src/core/index.js';
import { HoldemHandEvaluator, evaluateHand } from '../../src/holdem/index.js';
import { cards } from '../helpers.js';

const evaluator = new HoldemHandEvaluator();
const evaluate = (notation: string) => evaluateHand(cards(notation));

describe('catégories', () => {
  it.each([
    ['As Ks Qs Js Ts 2d 3c', 'STRAIGHT_FLUSH', ['A']],
    ['Kh Kd Kc Ks 2d Ad 3c', 'FOUR_OF_A_KIND', ['K', 'A']],
    ['Qh Qd Qc 7s 7d 7c 2h', 'FULL_HOUSE', ['Q', '7']],
    ['9h 8h 7h 6h 2h Ts 5c', 'FLUSH', ['9', '8', '7', '6', '2']],
    ['Ah 2d 3c 4s 5h Kd Qc', 'STRAIGHT', ['5']],
    ['Jh Jd Jc 9s 4d 3c 2h', 'THREE_OF_A_KIND', ['J', '9', '4']],
    ['Ah Ad Kc Ks Qd Qc 2h', 'TWO_PAIR', ['A', 'K', 'Q']],
    ['8h 8d Ac Ks 4d 3c 2h', 'ONE_PAIR', ['8', 'A', 'K', '4']],
    ['Ah Jd 9c 7s 5d 3c 2h', 'HIGH_CARD', ['A', 'J', '9', '7', '5']],
  ])('%s → %s', (notation, category, tiebreakers) => {
    const hand = evaluate(notation);
    expect(hand.category).toBe(category);
    expect(hand.tiebreakers).toEqual(tiebreakers);
  });

  it('ordonne la roue de 5 à As dans les 5 meilleures cartes', () => {
    expect(evaluate('Ah 2d 3c 4s 5h Kd Qc').bestFive.map(cardCode)).toEqual(['5h', '4s', '3c', '2d', 'Ah']);
  });

  it('classe toute catégorie au-dessus de la meilleure main de la catégorie inférieure', () => {
    const wheel = evaluate('Ah 2d 3c 4s 5h');
    const bestTrips = evaluate('Ah Ad Ac Ks Qd');
    expect(evaluator.compare(wheel, bestTrips)).toBe(1);
  });
});

describe('départage', () => {
  const board = 'Ah Kd 7c 7s 2d';

  it('départage par le kicker', () => {
    const queenKicker = evaluate(`${board} Qh 3c`);
    const jackKicker = evaluate(`${board} Jh 3d`);
    expect(evaluator.compare(queenKicker, jackKicker)).toBe(1);
  });

  it('partage quand le board joue pour les deux joueurs', () => {
    const royalBoard = 'As Ks Qs Js Ts';
    expect(evaluator.compare(evaluate(`${royalBoard} 2h 3h`), evaluate(`${royalBoard} 4d 5d`))).toBe(0);
  });

  it('ignore la 5e carte au-delà des tiebreakers d’un full', () => {
    expect(evaluator.compare(evaluate('Kh Kd Kc 9s 9d 2c 3h'), evaluate('Kh Kd Kc 9s 9d 4c 5h'))).toBe(0);
  });

  it('préfère la deuxième paire la plus haute parmi trois paires', () => {
    expect(evaluator.compare(evaluate('Th Td 9c 9s 3d 3c Ah'), evaluate('Th Td 9c 9s 3d 3c Kh'))).toBe(1);
  });
});

describe('entrées invalides', () => {
  it('refuse les doublons et les tailles hors 5 à 7', () => {
    expect(() => evaluate('As As Kd Qd Jd')).toThrow();
    expect(() => evaluate('As Kd Qd Jd')).toThrow();
    expect(() => evaluate('As Kd Qd Jd Td 9d 8d 7d')).toThrow();
  });
});
