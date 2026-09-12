import { invariant, shuffle, type RandomSource } from '../../core/index.js';
import type { RacingRules } from '../rules.js';
import type { Going, Horse, RaceCard, RaceResult } from '../types/race.js';
import { oddsFromProbability, PLACED_POSITIONS, strengthsOf } from './odds.js';
import { orderedProbability, sampleFinishOrder, topProbability } from './plackett-luce.js';

const HORSE_NAMES = [
  'Éclair du Nord', 'Tonnerre de Brest', 'Belle de Mai', 'Roi du Galop', 'Galop d’Or', 'Vent d’Ouest', 'Fleur de Lys',
  'Prince Noir', 'Comète Bleue', 'Étoile Filante', 'Sirocco', 'Ouragan', 'Cœur Vaillant', 'Rubis Rouge', 'Nuit Blanche',
  'Sans Souci', 'Belle Époque', 'Vif-Argent', 'Zéphyr', 'Cavalier Seul', 'Fier Destin', 'Or Massif', 'Sabre Clair',
  'Lune de Miel', 'Tempête', 'Grand Large', 'Feu Sacré', 'Diamant Brut', 'Marquise', 'Baron Rouge', 'Écume de Mer',
  'Jolie Brise', 'Beau Parleur', 'Flèche d’Argent', 'Tornade', 'Volcan', 'Soleil Levant', 'Rêve d’Enfant', 'Mistral', 'Hirondelle',
];
const JOCKEYS = ['L. Moreau', 'C. Dubois', 'A. Lefèvre', 'M. Garnier', 'J. Fontaine', 'S. Marchand', 'T. Girard', 'E. Rousseau', 'P. Lambert', 'N. Bonnet', 'R. Chevalier', 'V. Perrin'];
const SILKS = ['#d62828', '#1d4ed8', '#eab308', '#15803d', '#7c3aed', '#ea580c', '#0f172a', '#db2777', '#0891b2', '#78350f', '#65a30d', '#be123c'];
const HIPPODROMES = ['Hippodrome des Pins', 'Hippodrome du Val Fleuri', 'Hippodrome de la Côte d’Opale', 'Hippodrome des Trois Chênes', 'Hippodrome de Belle-Rive'];
const DISTANCES = [1_200, 1_600, 2_000, 2_400, 2_800];
const GOINGS: readonly Going[] = ['BON', 'BON', 'SOUPLE', 'LOURD'];
/** Vitesse moyenne du vainqueur selon le terrain, en m/s. */
const GOING_SPEED: Readonly<Record<Going, number>> = { BON: 16.4, SOUPLE: 15.8, LOURD: 15.0 };

const randomInt = (rng: RandomSource, min: number, max: number): number => min + rng.nextInt(max - min + 1);

function pick<T>(rng: RandomSource, items: readonly T[]): T {
  invariant(items.length > 0, 'Tirage dans une liste vide');
  return items[rng.nextInt(items.length)] as T;
}

function formFor(rng: RandomSource, rating: number): string {
  return Array.from({ length: 5 }, () => `${Math.max(1, Math.min(9, Math.round((100 - rating) / 7) + randomInt(rng, -2, 3)))}p`).join(' ');
}

/** Programme d'une course : partants, forme, forces et cotes des paris simples. */
export function createRaceCard(rng: RandomSource, rules: RacingRules, raceNumber: number): RaceCard {
  invariant(rules.runners <= SILKS.length && rules.runners <= JOCKEYS.length, `Pas plus de ${SILKS.length} partants`);
  const names = shuffle(HORSE_NAMES, rng).slice(0, rules.runners);
  const jockeys = shuffle(JOCKEYS, rng);
  const horses = names.map((name, index): Horse => {
    const rating = randomInt(rng, 55, 95);
    return {
      number: index + 1,
      name,
      jockey: jockeys[index] ?? 'Jockey',
      silk: SILKS[index] ?? '#888',
      form: formFor(rng, rating),
      strength: Math.round((rating / 10) ** 4),
    };
  });
  const strengths = new Map(horses.map((horse) => [horse.number, horse.strength]));
  return {
    raceNumber,
    hippodrome: pick(rng, HIPPODROMES),
    distance: pick(rng, DISTANCES),
    going: pick(rng, GOINGS),
    horses,
    odds: horses.map((horse) => ({
      number: horse.number,
      win: oddsFromProbability(orderedProbability(strengths, [horse.number]), rules.simpleMargin),
      place: oddsFromProbability(topProbability(strengths, horse.number, PLACED_POSITIONS), rules.simpleMargin),
    })),
  };
}

/** Court la course : arrivée tirée selon Plackett-Luce, chronos cohérents avec l'ordre. */
export function runRace(rng: RandomSource, card: RaceCard): RaceResult {
  const order = sampleFinishOrder(rng, strengthsOf(card));
  let time = Math.round((card.distance / GOING_SPEED[card.going]) * 100) + randomInt(rng, -120, 120);
  const times = order.map((number, index) => {
    if (index > 0) time += randomInt(rng, 6, 160);
    return { number, centiseconds: time };
  });
  return { order, times };
}
