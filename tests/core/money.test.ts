import { describe, expect, it } from 'vitest';
import {
  InvariantViolation,
  addChips,
  applyRatioFloor,
  chips,
  clockwiseFrom,
  splitEvenly,
  subtractChips,
  sumChips,
} from '../../src/core/index.js';

describe('arithmétique des jetons', () => {
  it('additionne et soustrait', () => {
    expect(addChips(chips(40), chips(2))).toBe(42);
    expect(sumChips([chips(1), chips(2), chips(3)])).toBe(6);
    expect(subtractChips(chips(50), chips(20))).toBe(30);
  });

  it('refuse un solde négatif', () => {
    expect(() => subtractChips(chips(10), chips(11))).toThrow(InvariantViolation);
  });

  it('refuse un dépassement des entiers sûrs', () => {
    expect(() => addChips(chips(Number.MAX_SAFE_INTEGER), chips(1))).toThrow();
  });

  it('applique un rapport en arrondissant à l’inférieur', () => {
    expect(applyRatioFloor(chips(25), { numerator: 3, denominator: 2 })).toBe(37);
    expect(applyRatioFloor(chips(20), { numerator: 3, denominator: 2 })).toBe(30);
  });

  it('partage en parts égales avec un reste indivisible', () => {
    expect(splitEvenly(chips(101), 3)).toEqual({ share: 33, remainder: 2 });
  });
});

describe('clockwiseFrom', () => {
  it('fait le tour de la table en commençant à gauche du siège donné', () => {
    expect(clockwiseFrom(7, 9)).toEqual([8, 0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
