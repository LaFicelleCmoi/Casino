import { describe, expect, it } from 'vitest';
import {
  EUROPEAN_BET_CATALOG,
  EUROPEAN_WHEEL_ORDER,
  RED_NUMBERS,
  colorOf,
  rouletteNumber,
  type BetKind,
  type BetSelection,
} from '../../src/roulette/index.js';
import { expectError, unwrap } from '../helpers.js';

const covers = (selection: BetSelection): number[] => [...unwrap(EUROPEAN_BET_CATALOG.resolve(selection)).covers];
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('cylindre européen', () => {
  it('contient les 37 numéros, chacun une seule fois', () => {
    expect([...EUROPEAN_WHEEL_ORDER].sort((a, b) => a - b)).toEqual(range(0, 36));
  });

  it('alterne rouge et noir après le zéro', () => {
    expect(colorOf(rouletteNumber(0))).toBe('GREEN');
    EUROPEAN_WHEEL_ORDER.slice(1).forEach((n, i) => expect(colorOf(n)).toBe(i % 2 === 0 ? 'RED' : 'BLACK'));
  });
});

describe('graphe des mises', () => {
  it.each<[BetKind, number]>([
    ['STRAIGHT', 37],
    ['SPLIT', 60],
    ['STREET', 14],
    ['CORNER', 23],
    ['SIX_LINE', 11],
    ['COLUMN', 3],
    ['DOZEN', 3],
    ['RED', 1],
    ['HIGH', 1],
  ])('%s : %i positions sur le tapis', (kind, count) => {
    expect(EUROPEAN_BET_CATALOG.all.filter((bet) => bet.kind === kind)).toHaveLength(count);
  });

  it('associe chaque position aux numéros exacts qu’elle couvre, quel que soit l’ordre de saisie', () => {
    expect(covers({ kind: 'CORNER', numbers: [5, 1, 4, 2] })).toEqual([1, 2, 4, 5]);
    expect(covers({ kind: 'SIX_LINE', numbers: [4, 5, 6, 1, 2, 3] })).toEqual(range(1, 6));
    expect(covers({ kind: 'STREET', numbers: [34, 35, 36] })).toEqual([34, 35, 36]);
    expect(covers({ kind: 'COLUMN', index: 1 })).toEqual(range(0, 11).map((i) => 3 * i + 1));
    expect(covers({ kind: 'DOZEN', index: 3 })).toEqual(range(25, 36));
    expect(covers({ kind: 'RED' })).toEqual([...RED_NUMBERS].sort((a, b) => a - b));
    expect(covers({ kind: 'LOW' })).toEqual(range(1, 18));
    expect(covers({ kind: 'EVEN' })).toEqual(range(1, 18).map((i) => 2 * i));
  });

  it('accepte les positions à cheval sur le zéro', () => {
    expect(covers({ kind: 'SPLIT', numbers: [0, 2] })).toEqual([0, 2]);
    expect(covers({ kind: 'STREET', numbers: [0, 2, 3] })).toEqual([0, 2, 3]);
    expect(covers({ kind: 'CORNER', numbers: [0, 1, 2, 3] })).toEqual([0, 1, 2, 3]);
  });

  it.each<[string, BetSelection]>([
    ['cheval en diagonale', { kind: 'SPLIT', numbers: [1, 5] }],
    ['cheval à cheval sur deux lignes', { kind: 'SPLIT', numbers: [3, 4] }],
    ['cheval hors tapis', { kind: 'SPLIT', numbers: [36, 37] }],
    ['cheval sur un même numéro', { kind: 'SPLIT', numbers: [8, 8] }],
    ['transversale décalée', { kind: 'STREET', numbers: [2, 3, 4] }],
    ['carré non contigu', { kind: 'CORNER', numbers: [3, 4, 6, 7] }],
    ['sixain non contigu', { kind: 'SIX_LINE', numbers: [1, 2, 3, 7, 8, 9] }],
    ['colonne inexistante', { kind: 'COLUMN', index: 4 } as unknown as BetSelection],
  ])('refuse un %s', (_label, selection) => {
    expectError(EUROPEAN_BET_CATALOG.resolve(selection), 'INVALID_BET');
  });

  it('paie chaque position 36 / n − 1 pour n numéros couverts', () => {
    for (const bet of EUROPEAN_BET_CATALOG.all) expect(bet.payout).toBe(36 / bet.covers.length - 1);
  });

  it('ne couvre jamais le zéro avec une mise externe', () => {
    const outside = EUROPEAN_BET_CATALOG.all.filter((bet) => bet.family === 'OUTSIDE');
    expect(outside).toHaveLength(12);
    for (const bet of outside) expect(bet.covers).not.toContain(0);
  });

  it('indexe les positions gagnantes de chaque numéro', () => {
    // 17 : plein, 4 chevaux, 1 transversale, 4 carrés, 2 sixains, colonne 2, douzaine 2, noir, impair, manque.
    expect(EUROPEAN_BET_CATALOG.betsCovering(rouletteNumber(17))).toHaveLength(17);
    // 0 : plein, chevaux 0-1 / 0-2 / 0-3, transversales 0-1-2 / 0-2-3, carré 0-1-2-3.
    expect(EUROPEAN_BET_CATALOG.betsCovering(rouletteNumber(0))).toHaveLength(7);
  });
});
