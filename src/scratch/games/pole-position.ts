import { chips, invariant, shuffle, type RandomSource } from '../../core/index.js';
import { lotTable } from '../prizes.js';
import type { ScratchGameDefinition, ScratchZone, ZoneResult } from '../types/ticket.js';
import {
  amountCell,
  chance,
  decoyAmount,
  firstCell,
  group,
  groupById,
  pick,
  randomInt,
  ticketEvaluation,
  zone,
  zoneById,
  zoneResult,
  type CellData,
} from './helpers.js';

/*
 * Règlement (inventé) du ticket « POLE POSITION JACKPOT », rédigé sur le modèle des règlements de grattage :
 *
 *  - Prix : 5 jetons. Blocs de 3 000 000 tickets.
 *  - Jeu 1 « Les Feux de Départ » : une rampe de 5 feux et une case MONTANT (5, 10, 20, 50, 100, 500 ou 2 500).
 *    Au moins 3 feux verts : le joueur remporte le MONTANT.
 *  - Jeu 2 « Le Duel Chrono » : « Temps de l'adversaire », « Votre temps » (mm:ss:cc) et la coupe
 *    (5, 10, 25, 50, 250, 1 000 ou 2 500). Votre temps strictement inférieur : le joueur remporte la somme de la coupe.
 *  - Jeu 3 « Pit-Stop Bonus » : sous le pneu, un pistolet pneumatique multiplie par 5 les gains des Jeux 1 et 2 ;
 *    un pneu seul ne rapporte rien.
 *  - Les gains des Jeux 1 et 2 s'additionnent, puis le Pit-Stop s'applique, pour former un lot unique du tableau.
 */

export const POLE_POSITION_LIGHTS_AMOUNTS = [5, 10, 20, 50, 100, 500, 2_500];
export const POLE_POSITION_DUEL_AMOUNTS = [5, 10, 25, 50, 250, 1_000, 2_500];
/** Gain maximum de la zone 2, sous la coupe du Duel Chrono. */
export const POLE_POSITION_DUEL_MAX = Math.max(...POLE_POSITION_DUEL_AMOUNTS);
export const PIT_STOP_MULTIPLIER = 5;
/** Chrono imbattable affiché quand la course est truquée. */
export const UNBEATABLE_LAP_TIME = 1;

const GREEN_LIGHTS_TO_WIN = 3;

/** Chrono au tour en centièmes → "mm:ss:cc" (8453 → "01:24:53", 1 → "00:00:01"). */
export function formatLapTime(centiseconds: number): string {
  const minutes = Math.floor(centiseconds / 6_000);
  const seconds = Math.floor((centiseconds % 6_000) / 100);
  return [minutes, seconds, centiseconds % 100].map((part) => String(part).padStart(2, '0')).join(':');
}

export interface RaceOutcome {
  readonly lights: number;
  readonly duel: number;
  readonly multiplier: 1 | typeof PIT_STOP_MULTIPLIER;
}

const RACE_OUTCOMES: readonly RaceOutcome[] = [0, ...POLE_POSITION_LIGHTS_AMOUNTS].flatMap((lights) =>
  [0, ...POLE_POSITION_DUEL_AMOUNTS].flatMap((duel) =>
    lights + duel === 0
      ? []
      : [1, PIT_STOP_MULTIPLIER].map((multiplier): RaceOutcome => ({ lights, duel, multiplier: multiplier as RaceOutcome['multiplier'] })),
  ),
);

/** Toutes les manières d'imprimer un gain total : (Feux + Duel) × Pit-Stop. */
export function raceOutcomesFor(total: number): readonly RaceOutcome[] {
  return RACE_OUTCOMES.filter((outcome) => (outcome.lights + outcome.duel) * outcome.multiplier === total);
}

function lightsZone(rng: RandomSource, win: number): ScratchZone {
  const greens = win > 0 ? randomInt(rng, GREEN_LIGHTS_TO_WIN, 4) : rng.nextInt(GREEN_LIGHTS_TO_WIN);
  const lights = shuffle(
    Array.from({ length: 5 }, (_, i): CellData => (i < greens ? { symbol: 'GREEN_LIGHT', label: 'Feu vert' } : { symbol: 'RED_LIGHT', label: 'Feu rouge' })),
    rng,
  );
  return zone('feux', 'Jeu 1 · Les Feux de Départ', 'La rampe compte 5 feux : au moins 3 feux verts, vous remportez la somme de la case Montant.', [
    group('feux', 'rampe', 'Rampe de départ', 5, lights),
    group('feux', 'montant', 'Montant', 1, [amountCell(win > 0 ? win : decoyAmount(rng, POLE_POSITION_LIGHTS_AMOUNTS))]),
  ]);
}

function duelZone(rng: RandomSource, win: number): ScratchZone {
  const opponent = randomInt(rng, 7_500, 9_500);
  const yours = win > 0 ? randomInt(rng, opponent - 900, opponent - 1) : randomInt(rng, opponent + 1, opponent + 900);
  const lap = (value: number): CellData => ({ symbol: 'LAP_TIME', label: formatLapTime(value), value });
  return zone(
    'duel',
    'Jeu 2 · Le Duel Chrono',
    'Votre temps au tour est strictement inférieur à celui de l’adversaire : vous empochez la somme cachée sous la coupe.',
    [
      group('duel', 'adversaire', 'Temps de l’adversaire', 1, [lap(opponent)]),
      group('duel', 'vous', 'Votre temps', 1, [lap(yours)]),
      group('duel', 'coupe', 'Sous la coupe', 1, [amountCell(win > 0 ? win : decoyAmount(rng, POLE_POSITION_DUEL_AMOUNTS))]),
    ],
  );
}

function pitStopZone(multiplier: number): ScratchZone {
  const cell: CellData =
    multiplier === PIT_STOP_MULTIPLIER ? { symbol: 'IMPACT_WRENCH', label: 'Pistolet pneumatique' } : { symbol: 'TIRE', label: 'Pneu' };
  return zone('pit', 'Jeu 3 · Pit-Stop Bonus', 'Sous le pneu, un pistolet pneumatique multiplie par 5 les gains des Jeux 1 et 2 ; un pneu seul ne rapporte rien.', [
    group('pit', 'pneu', 'Le pneu de la monoplace', 1, [cell]),
  ]);
}

/** Ticket Formule 1 inventé : départ, duel au chrono et arrêt au stand multiplicateur. */
export const POLE_POSITION: ScratchGameDefinition = {
  type: 'POLE_POSITION',
  name: 'Pole Position Jackpot',
  tagline: '3 zones de jeu · Multiplicateur Pit-Stop · Dépassez le chrono',
  price: chips(5),
  serialPrefix: 'PPJ',
  prizes: lotTable(3_000_000, [
    [2, 25_000],
    [8, 5_000],
    [40, 1_000],
    [1_200, 250],
    [12_000, 50],
    [60_000, 25],
    [100_000, 20],
    [250_000, 10],
    [600_000, 5],
  ]),

  generate(rng, prize) {
    const outcomes = raceOutcomesFor(prize);
    invariant(prize === 0 || outcomes.length > 0, `Gain ${prize} impossible à imprimer sur un Pole Position Jackpot`);
    const outcome: RaceOutcome =
      prize > 0 ? pick(rng, outcomes) : { lights: 0, duel: 0, multiplier: chance(rng, 1, 4) ? PIT_STOP_MULTIPLIER : 1 };
    return [lightsZone(rng, outcome.lights), duelZone(rng, outcome.duel), pitStopZone(outcome.multiplier)];
  },

  evaluate(zones) {
    const feux = zoneById(zones, 'feux');
    const greens = groupById(feux, 'rampe').cells.filter((cell) => cell.symbol === 'GREEN_LIGHT');
    const lightsAmount = firstCell(feux, 'montant');

    const duel = zoneById(zones, 'duel');
    const opponent = firstCell(duel, 'adversaire');
    const yours = firstCell(duel, 'vous');
    const cup = firstCell(duel, 'coupe');
    const faster = yours.value !== null && opponent.value !== null && yours.value < opponent.value;

    const tire = firstCell(zoneById(zones, 'pit'), 'pneu');
    const pistol = tire.symbol === 'IMPACT_WRENCH';

    const pitResult: ZoneResult = {
      zoneId: 'pit',
      won: pistol,
      amount: chips(0),
      detail: pistol ? `Pistolet pneumatique : gains × ${PIT_STOP_MULTIPLIER}` : 'Pas de pistolet',
      marks: pistol ? [tire.id] : [],
    };
    return ticketEvaluation(
      [
        greens.length >= GREEN_LIGHTS_TO_WIN && lightsAmount.amount !== null
          ? zoneResult('feux', lightsAmount.amount, `${greens.length} feux verts : départ canon`, [...greens.map((cell) => cell.id), lightsAmount.id])
          : zoneResult('feux', 0, greens.length === 0 ? 'Aucun feu vert' : `${greens.length} feu${greens.length > 1 ? 'x' : ''} vert${greens.length > 1 ? 's' : ''} seulement`),
        faster && cup.amount !== null
          ? zoneResult('duel', cup.amount, 'Chrono battu : la coupe est à vous', [yours.id, cup.id])
          : zoneResult('duel', 0, 'L’adversaire était plus rapide'),
        pitResult,
      ],
      pistol ? PIT_STOP_MULTIPLIER : 1,
    );
  },
};
