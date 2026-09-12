import { describe, expect, it } from 'vitest';
import { SeededRandomSource, chips } from '../../src/core/index.js';
import {
  FRENCH_WORDS,
  MORPION,
  POLE_POSITION,
  POLE_POSITION_DUEL_MAX,
  SCRATCH_GAME_LIST,
  UNBEATABLE_LAP_TIME,
  completedWords,
  expectedReturnRate,
  formatLapTime,
  maxPrize,
  winProbability,
  wordCells,
  type ScratchZone,
} from '../../src/scratch/index.js';

const rng = new SeededRandomSource('tickets-a-gratter');
const cellIds = (zones: readonly ScratchZone[]): string[] => zones.flatMap((zone) => zone.groups.flatMap((group) => group.cells.map((cell) => cell.id)));

describe.each(SCRATCH_GAME_LIST.map((game) => [game.name, game] as const))('%s', (_name, game) => {
  it('imprime pour chaque palier une grille dont l’évaluation donne exactement ce lot', () => {
    for (const amount of [0, ...game.prizes.tiers.map((tier) => tier.amount)]) {
      for (let i = 0; i < 25; i += 1) {
        const zones = game.generate(rng, chips(amount));
        expect(game.evaluate(zones).total).toBe(amount);
        const ids = cellIds(zones);
        expect(ids.length).toBeGreaterThan(0);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('reverse entre 55 et 70 % des mises, avec une chance de gain réaliste', () => {
    expect(expectedReturnRate(game.prizes, game.price)).toBeGreaterThan(0.55);
    expect(expectedReturnRate(game.prizes, game.price)).toBeLessThan(0.7);
    expect(winProbability(game.prizes)).toBeGreaterThan(0.15);
    expect(winProbability(game.prizes)).toBeLessThan(0.35);
    expect(maxPrize(game.prizes)).toBeGreaterThanOrEqual(game.price * 100);
  });
});

describe('Morpion', () => {
  it('paie le montant Gain pour un alignement et rien sans alignement', () => {
    for (let i = 0; i < 50; i += 1) {
      const winning = MORPION.generate(rng, chips(20));
      const result = MORPION.evaluate(winning);
      expect(result.total).toBe(20);
      expect(result.zones[0]?.marks.length).toBeGreaterThanOrEqual(4);
      expect(MORPION.evaluate(MORPION.generate(rng, chips(0))).total).toBe(0);
    }
  });
});

describe('Mots Croisés', () => {
  it('imprime des grilles cohérentes : lettres communes identiques et mots du dictionnaire', () => {
    const game = SCRATCH_GAME_LIST.find((candidate) => candidate.type === 'MEGA_MOTS_CROISES');
    expect(game).toBeDefined();
    for (let i = 0; i < 20; i += 1) {
      const zones = game?.generate(rng, chips(100)) ?? [];
      const board = zones.find((zone) => zone.id === 'grille')?.board;
      expect(board).toBeTruthy();
      if (!board) return;
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
      const letters = new Set(zones.find((zone) => zone.id === 'lettres')?.groups[0]?.cells.map((cell) => cell.label));
      expect(completedWords(board, letters)).toHaveLength(8);
    }
  });
});

describe('Pole Position Jackpot', () => {
  it('formate les chronos au tour en mm:ss:cc', () => {
    expect(formatLapTime(8_453)).toBe('01:24:53');
    expect(formatLapTime(UNBEATABLE_LAP_TIME)).toBe('00:00:01');
  });

  it('présente le ticket comme demandé', () => {
    expect(POLE_POSITION.tagline).toBe('3 zones de jeu · Multiplicateur Pit-Stop · Dépassez le chrono');
  });

  it('multiplie tous les gains par 5 quand le pistolet pneumatique apparaît', () => {
    let multiplied = 0;
    for (let i = 0; i < 400; i += 1) {
      const evaluation = POLE_POSITION.evaluate(POLE_POSITION.generate(rng, chips(500)));
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
                    ? { ...cell, amount: chips(POLE_POSITION_DUEL_MAX), label: '1 000' }
                    : cell,
              ),
            })),
          },
    );
    const duel = POLE_POSITION.evaluate(rigged).zones.find((zone) => zone.zoneId === 'duel');
    expect(duel).toMatchObject({ won: true, amount: 1_000 });
  });
});
