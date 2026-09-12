import { describe, expect, it } from 'vitest';
import { SeededRandomSource } from '../../src/core/index.js';
import {
  MIN_ODDS_CENTS,
  STANDARD_RACING_RULES,
  betOdds,
  betProbability,
  createRaceCard,
  formatOdds,
  isWinningBet,
  orderedProbability,
  permutations,
  runRace,
  sampleFinishOrder,
  strengthsOf,
  topProbability,
  unorderedProbability,
  type RaceBetKind,
  type RaceResult,
} from '../../src/racing/index.js';

const rng = new SeededRandomSource('courses-hippiques');
const card = createRaceCard(rng, STANDARD_RACING_RULES, 1);
const strengths = strengthsOf(card);
const numbers = card.horses.map((horse) => horse.number);
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

describe('modèle de Plackett-Luce', () => {
  it('donne des probabilités de victoire qui somment à 1 et de placé qui somment à 3', () => {
    expect(sum(numbers.map((n) => orderedProbability(strengths, [n])))).toBeCloseTo(1, 10);
    expect(sum(numbers.map((n) => topProbability(strengths, n, 3)))).toBeCloseTo(3, 10);
  });

  it('couvre toutes les arrivées possibles avec les tiercés dans l’ordre', () => {
    const triples = numbers.flatMap((a) => numbers.flatMap((b) => numbers.filter((c) => a !== b && b !== c && a !== c).map((c) => [a, b, c])));
    expect(triples).toHaveLength(336);
    expect(sum(triples.map((triple) => orderedProbability(strengths, triple)))).toBeCloseTo(1, 10);
  });

  it('évalue le désordre comme la somme des ordres possibles', () => {
    const [a = 1, b = 2, c = 3, d = 4, e = 5] = numbers;
    expect(unorderedProbability(strengths, [a, b, c])).toBeCloseTo(sum(permutations([a, b, c]).map((order) => orderedProbability(strengths, order))), 12);
    expect(permutations([a, b, c, d, e])).toHaveLength(120);
  });

  it('tire des arrivées conformes aux probabilités du modèle', () => {
    const wins = new Map<number, number>();
    const draws = 20_000;
    for (let i = 0; i < draws; i += 1) {
      const [winner = 0] = sampleFinishOrder(rng, strengths);
      wins.set(winner, (wins.get(winner) ?? 0) + 1);
    }
    for (const n of numbers) expect((wins.get(n) ?? 0) / draws).toBeCloseTo(orderedProbability(strengths, [n]), 1);
  });

  it('produit des chronos cohérents avec l’ordre d’arrivée', () => {
    const result = runRace(rng, card);
    expect([...result.order].sort()).toEqual([...numbers].sort());
    result.times.forEach((time, index) => {
      expect(time.number).toBe(result.order[index]);
      if (index > 0) expect(time.centiseconds).toBeGreaterThan(result.times[index - 1]?.centiseconds ?? 0);
    });
  });
});

describe('cotes', () => {
  it('reversent 85 % sur les paris simples et 75 % sur les combinés, hors cote plancher', () => {
    const rate = (kind: RaceBetKind, horses: number[], margin: number): void => {
      const selection = { kind, horses } as unknown as Parameters<typeof betOdds>[2];
      const odds = betOdds(card, STANDARD_RACING_RULES, selection);
      if (odds === MIN_ODDS_CENTS) return;
      const expected = betProbability(card, kind, horses) * (odds / 100);
      expect(expected).toBeLessThanOrEqual(1 - margin + 1e-9);
      expect(expected).toBeGreaterThan(1 - margin - 0.01);
    };
    for (const n of numbers) {
      rate('GAGNANT', [n], 0.15);
      rate('PLACE', [n], 0.15);
    }
    rate('TIERCE_ORDRE', numbers.slice(0, 3), 0.25);
    rate('QUINTE_DESORDRE', numbers.slice(2, 7), 0.25);
  });

  it('s’affichent au format français', () => {
    expect(formatOdds(350)).toBe('3,50');
    expect(formatOdds(12_345)).toBe('123,45');
  });
});

describe('résultat des paris', () => {
  const result: RaceResult = { order: [3, 1, 4, 5, 2, 6, 7, 8], times: [] };
  it.each<[RaceBetKind, number[], boolean]>([
    ['GAGNANT', [3], true],
    ['GAGNANT', [1], false],
    ['PLACE', [4], true],
    ['PLACE', [5], false],
    ['TIERCE_ORDRE', [3, 1, 4], true],
    ['TIERCE_ORDRE', [1, 3, 4], false],
    ['TIERCE_DESORDRE', [4, 3, 1], true],
    ['TIERCE_DESORDRE', [3, 1, 5], false],
    ['QUINTE_ORDRE', [3, 1, 4, 5, 2], true],
    ['QUINTE_ORDRE', [3, 1, 4, 2, 5], false],
    ['QUINTE_DESORDRE', [2, 5, 4, 1, 3], true],
    ['QUINTE_DESORDRE', [2, 5, 4, 1, 6], false],
  ])('%s %j → %s', (kind, horses, expected) => {
    expect(isWinningBet(result, kind, horses)).toBe(expected);
  });
});
