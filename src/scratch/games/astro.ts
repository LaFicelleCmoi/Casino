import { chips, invariant, shuffle, type RandomSource } from '../../core/index.js';
import { lotTable } from '../prizes.js';
import type { ScratchGameDefinition, ZoneResult } from '../types/ticket.js';
import {
  amountCell,
  bySymbol,
  chooseDecomposition,
  decoyAmount,
  firstCell,
  group,
  groupById,
  partsFor,
  pick,
  ticketEvaluation,
  zone,
  zoneById,
  zoneResult,
  type CellData,
  type PrizeSlot,
} from './helpers.js';

export const ZODIAC_SIGNS = [
  ['BELIER', '♈', 'Bélier'],
  ['TAUREAU', '♉', 'Taureau'],
  ['GEMEAUX', '♊', 'Gémeaux'],
  ['CANCER', '♋', 'Cancer'],
  ['LION', '♌', 'Lion'],
  ['VIERGE', '♍', 'Vierge'],
  ['BALANCE', '♎', 'Balance'],
  ['SCORPION', '♏', 'Scorpion'],
  ['SAGITTAIRE', '♐', 'Sagittaire'],
  ['CAPRICORNE', '♑', 'Capricorne'],
  ['VERSEAU', '♒', 'Verseau'],
  ['POISSONS', '♓', 'Poissons'],
] as const;
type SignCode = (typeof ZODIAC_SIGNS)[number][0];

export const ELEMENTS = [
  ['TERRE', '🌍', 'Terre'],
  ['AIR', '💨', 'Air'],
  ['EAU', '💧', 'Eau'],
  ['FEU', '🔥', 'Feu'],
] as const;
type ElementCode = (typeof ELEMENTS)[number][0];

/** Élément associé à chaque signe, selon le tableau du règlement FDJ. */
export const SIGN_ELEMENTS: Readonly<Record<SignCode, ElementCode>> = {
  CAPRICORNE: 'TERRE',
  TAUREAU: 'TERRE',
  VIERGE: 'TERRE',
  VERSEAU: 'AIR',
  GEMEAUX: 'AIR',
  BALANCE: 'AIR',
  POISSONS: 'EAU',
  CANCER: 'EAU',
  SCORPION: 'EAU',
  BELIER: 'FEU',
  LION: 'FEU',
  SAGITTAIRE: 'FEU',
};

const QUALITIES = ['Courage', 'Générosité', 'Loyauté', 'Patience', 'Élégance', 'Sagesse', 'Audace', 'Charme', 'Humour', 'Franchise'];
const QUALITY_PREFIX = 'QUALITE:';
const GAIN_1 = [2, 4, 6, 10, 20, 100, 1_000, 25_000];
const GAIN_2 = [2, 4, 6, 10, 20, 100, 1_000];
const BONUS = [2, 4, 10];
const SLOTS: readonly PrizeSlot[] = [
  { id: 'jeu1', capacity: 1, amounts: GAIN_1 },
  { id: 'jeu2', capacity: 1, amounts: GAIN_2 },
  { id: 'bonus', capacity: 1, amounts: BONUS },
];
const STARS = 8;

const qualityCell = (quality: string): CellData => ({ symbol: `${QUALITY_PREFIX}${quality}`, label: quality });

function starsFor(rng: RandomSource, sign: (typeof ZODIAC_SIGNS)[number], winJeu1: boolean, winJeu2: boolean): CellData[] {
  const stars: CellData[] = [];
  const ownSigns = winJeu1 ? 2 : rng.nextInt(2);
  for (let i = 0; i < ownSigns; i += 1) stars.push({ symbol: sign[0], label: sign[1] });
  const qualities = shuffle(QUALITIES, rng);
  if (winJeu2) {
    const pair = qualities.shift();
    invariant(pair !== undefined, 'Qualité manquante');
    stars.push(qualityCell(pair), qualityCell(pair));
  }
  const otherSigns = shuffle(ZODIAC_SIGNS.filter((candidate) => candidate !== sign), rng);
  while (stars.length < STARS) {
    const quality = rng.nextInt(2) === 0 ? qualities.shift() : undefined;
    if (quality !== undefined) {
      stars.push(qualityCell(quality));
      continue;
    }
    const other = otherSigns.shift();
    invariant(other !== undefined, 'Signe manquant');
    stars.push({ symbol: other[0], label: other[1] });
  }
  return shuffle(stars, rng);
}

/** Astro, d'après le règlement FDJ : 8 étoiles pour le Jeu 1 (votre signe) et le Jeu 2 (les qualités), plus le Bonus des éléments. */
export const ASTRO: ScratchGameDefinition = {
  type: 'ASTRO',
  name: 'Astro',
  tagline: 'Votre signe, vos qualités, votre élément · 3 jeux · jusqu’à 25 000',
  price: chips(2),
  serialPrefix: 'AST',
  prizes: lotTable(4_500_000, [
    [3, 25_000],
    [8, 1_000],
    [300, 100],
    [45_000, 20],
    [100_000, 10],
    [158_000, 6],
    [500_000, 4],
    [602_000, 2],
  ]),

  generate(rng, prize) {
    const parts = chooseDecomposition(rng, prize, SLOTS, 3);
    const [gain1] = partsFor(parts, 'jeu1');
    const [gain2] = partsFor(parts, 'jeu2');
    const [bonus] = partsFor(parts, 'bonus');
    const sign = pick(rng, ZODIAC_SIGNS);
    const element = ELEMENTS.find((candidate) => candidate[0] === SIGN_ELEMENTS[sign[0]]);
    invariant(element !== undefined, `Élément inconnu pour ${sign[2]}`);

    const others = ELEMENTS.filter((candidate) => candidate !== element);
    const ownElements = bonus !== undefined ? 2 : rng.nextInt(2);
    const constellation = shuffle(
      Array.from({ length: 3 }, (_, i): CellData => {
        const [symbol, glyph, name] = i < ownElements ? element : pick(rng, others);
        return { symbol, label: `${glyph} ${name}` };
      }),
      rng,
    );

    return [
      zone('etoiles', 'Jeu 1 & Jeu 2 · Les étoiles', 'Jeu 1 : deux fois votre signe sous les étoiles, vous remportez le GAIN 1. Jeu 2 : deux qualités identiques, vous remportez le GAIN 2.', [
        group('etoiles', 'signe', 'Votre signe', 1, [{ symbol: sign[0], label: `${sign[1]} ${sign[2]}` }], true),
        group('etoiles', 'etoiles', 'Les 8 étoiles', 4, starsFor(rng, sign, gain1 !== undefined, gain2 !== undefined)),
        group('etoiles', 'gain1', 'GAIN 1', 1, [amountCell(gain1 ?? decoyAmount(rng, GAIN_1))]),
        group('etoiles', 'gain2', 'GAIN 2', 1, [amountCell(gain2 ?? decoyAmount(rng, GAIN_2))]),
      ]),
      zone('bonus', 'Bonus · La constellation', 'Deux fois l’élément de votre signe dans la constellation : vous remportez le gain du Bonus.', [
        group('bonus', 'element', 'Votre élément', 1, [{ symbol: element[0], label: `${element[1]} ${element[2]}` }], true),
        group('bonus', 'constellation', 'La constellation', 3, constellation),
        group('bonus', 'gain', 'GAIN', 1, [amountCell(bonus ?? decoyAmount(rng, BONUS))]),
      ]),
    ];
  },

  evaluate(zones) {
    const etoiles = zoneById(zones, 'etoiles');
    const sign = firstCell(etoiles, 'signe');
    const stars = groupById(etoiles, 'etoiles').cells;
    const signStars = stars.filter((cell) => cell.symbol === sign.symbol);
    const gain1 = firstCell(etoiles, 'gain1');
    const jeu1 = signStars.length >= 2 ? (gain1.amount ?? 0) : 0;
    const qualityPair = [...bySymbol(stars.filter((cell) => cell.symbol.startsWith(QUALITY_PREFIX))).values()].find((cells) => cells.length >= 2);
    const gain2 = firstCell(etoiles, 'gain2');
    const jeu2 = qualityPair !== undefined ? (gain2.amount ?? 0) : 0;

    const bonusZone = zoneById(zones, 'bonus');
    const element = firstCell(bonusZone, 'element');
    const found = groupById(bonusZone, 'constellation').cells.filter((cell) => cell.symbol === element.symbol);
    const bonusGain = firstCell(bonusZone, 'gain');
    const bonus = found.length >= 2 ? (bonusGain.amount ?? 0) : 0;

    const details = [jeu1 > 0 ? 'Jeu 1 : votre signe deux fois' : '', jeu2 > 0 ? `Jeu 2 : ${qualityPair?.[0]?.label ?? ''} deux fois` : ''].filter(Boolean);
    const starsResult: ZoneResult = zoneResult(
      'etoiles',
      jeu1 + jeu2,
      details.length > 0 ? details.join(' · ') : 'Ni signe ni qualité en double',
      [...(jeu1 > 0 ? [...signStars.map((cell) => cell.id), gain1.id] : []), ...(jeu2 > 0 ? [...(qualityPair ?? []).map((cell) => cell.id), gain2.id] : [])],
    );
    return ticketEvaluation([
      starsResult,
      bonus > 0
        ? zoneResult('bonus', bonus, `Deux fois ${element.label}`, [...found.map((cell) => cell.id), bonusGain.id])
        : zoneResult('bonus', 0, 'Votre élément n’apparaît pas deux fois'),
    ]);
  },
};
