import { describe, expect, it } from 'vitest';
import { bigChips } from '../../src/core/index.js';
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

const bet = (selection: BetSelection, amount: bigint): PlacedBet => ({
  betId: unwrap(EUROPEAN_BET_CATALOG.resolve(selection)).id,
  amount: bigChips(amount),
});

describe('PayoutEngine', () => {
  it.each<[string, BetSelection, bigint]>([
    ['Plein (35:1)', { kind: 'STRAIGHT', numbers: [17] }, 360n],
    ['Cheval (17:1)', { kind: 'SPLIT', numbers: [17, 20] }, 180n],
    ['Transversale (11:1)', { kind: 'STREET', numbers: [16, 17, 18] }, 120n],
    ['Carré (8:1)', { kind: 'CORNER', numbers: [13, 14, 16, 17] }, 90n],
    ['Sixain (5:1)', { kind: 'SIX_LINE', numbers: [13, 14, 15, 16, 17, 18] }, 60n],
    ['Colonne (2:1)', { kind: 'COLUMN', index: 2 }, 30n],
    ['Douzaine (2:1)', { kind: 'DOZEN', index: 2 }, 30n],
    ['Noir (1:1)', { kind: 'BLACK' }, 20n],
    ['Impair (1:1)', { kind: 'ODD' }, 20n],
    ['Manque (1:1)', { kind: 'LOW' }, 20n],
  ])('%s : 10 jetons rendent %s quand le 17 sort', (_label, selection, returned) => {
    const result = engine.evaluateBet(bet(selection, 10n), rouletteNumber(17));
    expect(result).toMatchObject({ won: true, stake: 10n, returned, net: returned - 10n });
  });

  it('perd intégralement une mise qui ne couvre pas le numéro sorti', () => {
    expect(engine.evaluateBet(bet({ kind: 'RED' }, 10n), rouletteNumber(17))).toMatchObject({ won: false, returned: 0n, net: -10n });
  });

  it('balaye toutes les mises actives et totalise le tour', () => {
    const settlement = engine.settle([bet({ kind: 'RED' }, 10n), bet({ kind: 'STRAIGHT', numbers: [17] }, 10n)], rouletteNumber(17));
    expect(settlement).toMatchObject({ totalStaked: 20n, totalReturned: 360n, net: 340n });
    expect(settlement.bets.map((result) => result.won)).toEqual([false, true]);
  });

  it('règle du zéro : toutes les mises externes sont perdues, les mises internes sur le 0 sont payées', () => {
    const outside = EUROPEAN_BET_CATALOG.all.filter((definition) => definition.family === 'OUTSIDE');
    const outsideSettlement = engine.settle(
      outside.map((definition) => ({ betId: definition.id, amount: bigChips(10) })),
      rouletteNumber(0),
    );
    expect(outsideSettlement).toMatchObject({ totalStaked: 120n, totalReturned: 0n, net: -120n });

    const zeroBets = [bet({ kind: 'STRAIGHT', numbers: [0] }, 10n), bet({ kind: 'CORNER', numbers: [0, 1, 2, 3] }, 10n)];
    expect(engine.settle(zeroBets, rouletteNumber(0)).totalReturned).toBe(360n + 90n);
  });

  it("rend en moyenne 36/37 de la mise : l'avantage de la maison vient du seul zéro", () => {
    for (const definition of EUROPEAN_BET_CATALOG.all) {
      const placed: PlacedBet = { betId: definition.id, amount: bigChips(1) };
      const returnedOverWheel = ALL_NUMBERS.reduce((sum, n) => sum + engine.evaluateBet(placed, n).returned, 0n);
      expect(returnedOverWheel).toBe(36n);
    }
  });

  it('paie sans arrondi une mise dépassant Number.MAX_SAFE_INTEGER', () => {
    const amount = BigInt(Number.MAX_SAFE_INTEGER) * 1_000n + 7n;
    expect(engine.evaluateBet(bet({ kind: 'STRAIGHT', numbers: [17] }, amount), rouletteNumber(17)).returned).toBe(amount * 36n);
  });
});
