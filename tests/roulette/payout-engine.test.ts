import { describe, expect, it } from 'vitest';
import { chips } from '../../src/core/index.js';
import {
  ALL_NUMBERS,
  EUROPEAN_BET_CATALOG,
  PayoutEngine,
  rouletteNumber,
  type BetSelection,
  type PlacedBet,
} from '../../src/roulette/index.js';
import { unwrap } from '../helpers.js';

const engine = new PayoutEngine();

const bet = (selection: BetSelection, amount: number): PlacedBet => ({
  betId: unwrap(EUROPEAN_BET_CATALOG.resolve(selection)).id,
  amount: chips(amount),
});

describe('PayoutEngine', () => {
  it.each<[string, BetSelection, number]>([
    ['Plein (35:1)', { kind: 'STRAIGHT', numbers: [17] }, 360],
    ['Cheval (17:1)', { kind: 'SPLIT', numbers: [17, 20] }, 180],
    ['Transversale (11:1)', { kind: 'STREET', numbers: [16, 17, 18] }, 120],
    ['Carré (8:1)', { kind: 'CORNER', numbers: [13, 14, 16, 17] }, 90],
    ['Sixain (5:1)', { kind: 'SIX_LINE', numbers: [13, 14, 15, 16, 17, 18] }, 60],
    ['Colonne (2:1)', { kind: 'COLUMN', index: 2 }, 30],
    ['Douzaine (2:1)', { kind: 'DOZEN', index: 2 }, 30],
    ['Noir (1:1)', { kind: 'BLACK' }, 20],
    ['Impair (1:1)', { kind: 'ODD' }, 20],
    ['Manque (1:1)', { kind: 'LOW' }, 20],
  ])('%s : 10 jetons rendent %i quand le 17 sort', (_label, selection, returned) => {
    const result = engine.evaluateBet(bet(selection, 10), rouletteNumber(17));
    expect(result).toMatchObject({ won: true, stake: 10, returned, net: returned - 10 });
  });

  it('perd intégralement une mise qui ne couvre pas le numéro sorti', () => {
    expect(engine.evaluateBet(bet({ kind: 'RED' }, 10), rouletteNumber(17))).toMatchObject({ won: false, returned: 0, net: -10 });
  });

  it('balaye toutes les mises actives et totalise le tour', () => {
    const settlement = engine.settle([bet({ kind: 'RED' }, 10), bet({ kind: 'STRAIGHT', numbers: [17] }, 10)], rouletteNumber(17));
    expect(settlement).toMatchObject({ totalStaked: 20, totalReturned: 360, net: 340 });
    expect(settlement.bets.map((result) => result.won)).toEqual([false, true]);
  });

  it('règle du zéro : toutes les mises externes sont perdues, les mises internes sur le 0 sont payées', () => {
    const outside = EUROPEAN_BET_CATALOG.all.filter((definition) => definition.family === 'OUTSIDE');
    const outsideSettlement = engine.settle(
      outside.map((definition) => ({ betId: definition.id, amount: chips(10) })),
      rouletteNumber(0),
    );
    expect(outsideSettlement).toMatchObject({ totalStaked: 120, totalReturned: 0, net: -120 });

    const zeroBets = [bet({ kind: 'STRAIGHT', numbers: [0] }, 10), bet({ kind: 'CORNER', numbers: [0, 1, 2, 3] }, 10)];
    expect(engine.settle(zeroBets, rouletteNumber(0)).totalReturned).toBe(360 + 90);
  });

  it("rend en moyenne 36/37 de la mise : l'avantage de la maison vient du seul zéro", () => {
    for (const definition of EUROPEAN_BET_CATALOG.all) {
      const placed: PlacedBet = { betId: definition.id, amount: chips(1) };
      const returnedOverWheel = ALL_NUMBERS.reduce((sum, n) => sum + engine.evaluateBet(placed, n).returned, 0);
      expect(returnedOverWheel).toBe(36);
    }
  });
});
