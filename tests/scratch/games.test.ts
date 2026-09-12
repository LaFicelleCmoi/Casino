import { describe, expect, it } from 'vitest';
import { SeededRandomSource, chips } from '../../src/core/index.js';
import {
  ASTRO,
  BANCO,
  CASH,
  CASH_NUMBERS,
  FRENCH_WORDS,
  MAXI_MOTS_CROISES,
  MEGA_MOTS_CROISES,
  MORPION,
  MOTS_CROISES,
  POLE_POSITION,
  POLE_POSITION_DUEL_MAX,
  SCRATCH_GAME_LIST,
  SIGN_ELEMENTS,
  UNBEATABLE_LAP_TIME,
  completedWords,
  expectedReturnRate,
  formatAmount,
  formatLapTime,
  maxPrize,
  ticketCellIds,
  winProbability,
  wordCells,
  type CrosswordBoard,
  type ScratchCell,
  type ScratchZone,
  type TicketTypeId,
} from '../../src/scratch/index.js';

const rng = new SeededRandomSource('tickets-fdj');

const cellsIn = (zones: readonly ScratchZone[], zoneId: string, groupId: string): readonly ScratchCell[] =>
  zones.find((zone) => zone.id === zoneId)?.groups.find((group) => group.id === groupId)?.cells ?? [];
const boardOf = (zones: readonly ScratchZone[], zoneId: string): CrosswordBoard | null => zones.find((zone) => zone.id === zoneId)?.board ?? null;

/** Taux de redistribution, chances et gain maximum tirés des tableaux de lots des règlements. */
const OFFICIAL: Readonly<Record<TicketTypeId, { price: number; max: number; oneIn: number; rate: number }>> = {
  BANCO: { price: 1, max: 5_000, oneIn: 3.83, rate: 0.645 },
  CASH: { price: 5, max: 500_000, oneIn: 3.82, rate: 0.7 },
  // 0,50 € et lots de 0,50 € à 3 000 € dans le règlement : prix et lots doublés pour rester en jetons entiers.
  MORPION: { price: 1, max: 6_000, oneIn: 3.6, rate: 1_036_800 / 1_500_000 },
  MILLIONNAIRE: { price: 10, max: 1_000_000, oneIn: 3.35, rate: 0.735 },
  VEGAS: { price: 3, max: 50_000, oneIn: 3.81, rate: 0.7 },
  MOTS_CROISES: { price: 3, max: 40_000, oneIn: 3.98, rate: 9_382_500 / 13_500_000 },
  MAXI_MOTS_CROISES: { price: 5, max: 250_000, oneIn: 3.77, rate: 0.7 },
  MEGA_MOTS_CROISES: { price: 10, max: 600_000, oneIn: 2.94, rate: 0.72 },
  ASTRO: { price: 2, max: 25_000, oneIn: 3.2, rate: 0.685 },
  POLE_POSITION: { price: 5, max: 25_000, oneIn: 2.93, rate: 10_030_000 / 15_000_000 },
};

function expectConsistentBoard(board: CrosswordBoard | null, wordCount: number): void {
  expect(board).not.toBeNull();
  if (board === null) return;
  expect(board.words).toHaveLength(wordCount);
  const grid = new Map<string, string>();
  for (const placed of board.words) {
    expect(FRENCH_WORDS).toContain(placed.word);
    for (const { row, column, letter } of wordCells(placed)) {
      expect(row).toBeLessThan(board.height);
      expect(column).toBeLessThan(board.width);
      const key = `${row},${column}`;
      expect(grid.get(key) ?? letter).toBe(letter);
      grid.set(key, letter);
    }
  }
}

describe.each(SCRATCH_GAME_LIST.map((game) => [game.name, game] as const))('%s', (_name, game) => {
  it('reprend le prix, le gain maximum, les chances et la redistribution du règlement', () => {
    const official = OFFICIAL[game.type];
    expect(game.price).toBe(official.price);
    expect(maxPrize(game.prizes)).toBe(official.max);
    expect(1 / winProbability(game.prizes)).toBeCloseTo(official.oneIn, 1);
    expect(expectedReturnRate(game.prizes, game.price)).toBeCloseTo(official.rate, 3);
  });

  it('imprime pour chaque lot du tableau une grille dont l’évaluation donne exactement ce lot', () => {
    const samples = game.type.includes('MOTS') ? 4 : 25;
    for (const amount of [0, ...game.prizes.tiers.map((tier) => tier.amount)]) {
      for (let i = 0; i < samples; i += 1) {
        const zones = game.generate(rng, chips(amount));
        expect(game.evaluate(zones).total).toBe(amount);
        const ids = ticketCellIds({ zones });
        expect(ids.length).toBeGreaterThan(0);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
});

describe('Banco', () => {
  it('cumule les sommes non nulles des deux zones', () => {
    for (let i = 0; i < 50; i += 1) {
      const zones = BANCO.generate(rng, chips(10));
      const amounts = [...cellsIn(zones, 'banco', 'gain1'), ...cellsIn(zones, 'banco', 'gain2')].map((cell) => cell.amount ?? 0);
      expect(amounts[0]! + amounts[1]!).toBe(10);
    }
    expect(cellsIn(BANCO.generate(rng, chips(0)), 'banco', 'gain1')[0]?.amount).toBe(0);
  });
});

describe('Cash', () => {
  it('oppose 20 numéros distincts à 5 numéros gagnants, pris dans la liste du règlement', () => {
    const zones = CASH.generate(rng, chips(500_000));
    const yours = cellsIn(zones, 'cash', 'vos-numeros').map((cell) => cell.value ?? 0);
    const winning = cellsIn(zones, 'cash', 'gagnants').map((cell) => cell.value ?? 0);
    expect(yours).toHaveLength(20);
    expect(winning).toHaveLength(5);
    expect(new Set(yours).size).toBe(20);
    expect(new Set(winning).size).toBe(5);
    for (const n of [...yours, ...winning]) expect(CASH_NUMBERS).toContain(n);
    expect([5, 10, 20].some((excluded) => CASH_NUMBERS.includes(excluded))).toBe(false);
  });
});

describe('Morpion', () => {
  it('imprime la somme de chaque alignement et ne fait gagner qu’un alignement', () => {
    for (let i = 0; i < 50; i += 1) {
      const zones = MORPION.generate(rng, chips(1_000));
      const lines = cellsIn(zones, 'morpion', 'gains');
      expect(lines).toHaveLength(8);
      expect(ticketCellIds({ zones })).toHaveLength(9);
      const result = MORPION.evaluate(zones).zones[0];
      expect(result?.amount).toBe(1_000);
      expect(result?.marks.filter((mark) => mark.startsWith('morpion.gains'))).toHaveLength(1);
    }
  });
});

describe('Astro', () => {
  it('associe le bon élément au signe du ticket et imprime 8 étoiles', () => {
    for (let i = 0; i < 30; i += 1) {
      const zones = ASTRO.generate(rng, chips(6));
      const sign = cellsIn(zones, 'etoiles', 'signe')[0];
      const element = cellsIn(zones, 'bonus', 'element')[0];
      expect(cellsIn(zones, 'etoiles', 'etoiles')).toHaveLength(8);
      expect(element?.symbol).toBe(SIGN_ELEMENTS[sign?.symbol as keyof typeof SIGN_ELEMENTS]);
    }
  });
});

describe('Mots Croisés', () => {
  it('Mots Croisés : 14 lettres distinctes, 18 mots, et le lot correspond au nombre de mots', () => {
    const zones = MOTS_CROISES.generate(rng, chips(30));
    const letters = cellsIn(zones, 'lettres', 'lettres').map((cell) => cell.label);
    expect(new Set(letters).size).toBe(14);
    const board = boardOf(zones, 'grille');
    expectConsistentBoard(board, 18);
    if (board !== null) expect(completedWords(board, new Set(letters))).toHaveLength(5);
  });

  it('Maxi Mots Croisés : 18 lettres pour deux grilles de 18 mots aux gains cumulés', () => {
    const zones = MAXI_MOTS_CROISES.generate(rng, chips(250_000));
    const letters = new Set(cellsIn(zones, 'lettres', 'lettres').map((cell) => cell.label));
    expect(letters.size).toBe(18);
    for (const grid of ['grille1', 'grille2']) {
      const board = boardOf(zones, grid);
      expectConsistentBoard(board, 18);
      if (board !== null) expect(completedWords(board, letters)).toHaveLength(9);
    }
  });

  it('Méga Mots Croisés : grille de 27 mots, deux mots mystères et six mots à reconstituer', () => {
    const zones = MEGA_MOTS_CROISES.generate(rng, chips(200));
    expect(new Set(cellsIn(zones, 'lettres', 'lettres').map((cell) => cell.label)).size).toBe(20);
    expectConsistentBoard(boardOf(zones, 'grille'), 27);
    expect(zones.find((zone) => zone.id === 'mysteres')?.groups).toHaveLength(2);
    expect(new Set(cellsIn(zones, 'six-mots', 'lettres').map((cell) => cell.label)).size).toBe(14);
    expect(cellsIn(zones, 'six-mots', 'mots')).toHaveLength(6);
  });
});

describe('Pole Position Jackpot (règles inventées)', () => {
  it('formate les chronos au tour en mm:ss:cc', () => {
    expect(formatLapTime(8_453)).toBe('01:24:53');
    expect(formatLapTime(UNBEATABLE_LAP_TIME)).toBe('00:00:01');
  });

  it('présente le ticket comme demandé', () => {
    expect(POLE_POSITION.tagline).toBe('3 zones de jeu · Multiplicateur Pit-Stop · Dépassez le chrono');
  });

  it('multiplie tous les gains par 5 quand le pistolet pneumatique apparaît', () => {
    let multiplied = 0;
    for (let i = 0; i < 200; i += 1) {
      const evaluation = POLE_POSITION.evaluate(POLE_POSITION.generate(rng, chips(5_000)));
      const base = evaluation.zones.reduce((sum, zone) => sum + zone.amount, 0);
      expect(evaluation.total).toBe(base * evaluation.multiplier);
      if (evaluation.multiplier === 5) multiplied += 1;
    }
    expect(multiplied).toBeGreaterThan(0);
  });

  it('une course truquée à 00:00:01 garantit le gain maximum de la zone 2', () => {
    const zones = POLE_POSITION.generate(rng, chips(0));
    const rigged = zones.map((zone) =>
      zone.id !== 'duel'
        ? zone
        : {
            ...zone,
            groups: zone.groups.map((group) => ({
              ...group,
              cells: group.cells.map((cell) =>
                group.id === 'vous'
                  ? { ...cell, value: UNBEATABLE_LAP_TIME, label: formatLapTime(UNBEATABLE_LAP_TIME) }
                  : group.id === 'coupe'
                    ? { ...cell, amount: chips(POLE_POSITION_DUEL_MAX), label: formatAmount(POLE_POSITION_DUEL_MAX) }
                    : cell,
              ),
            })),
          },
    );
    const duel = POLE_POSITION.evaluate(rigged).zones.find((zone) => zone.zoneId === 'duel');
    expect(duel).toMatchObject({ won: true, amount: POLE_POSITION_DUEL_MAX });
  });
});
