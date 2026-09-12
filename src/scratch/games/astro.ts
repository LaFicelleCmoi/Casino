import { chips, shuffle } from '../../core/index.js';
import { prizeTable } from '../prizes.js';
import type { ScratchGameDefinition } from '../types/ticket.js';
import { firstCell, group, groupById, pick, ticketEvaluation, zone, zoneById, zoneResult, type CellData } from './helpers.js';

const AMOUNTS = [2, 4, 10, 20, 50, 500, 5_000];

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

export const ASTRO: ScratchGameDefinition = {
  type: 'ASTRO',
  name: 'Astro',
  tagline: 'Les 12 signes du zodiaque · votre signe dans le ciel = le montant indiqué',
  price: chips(2),
  serialPrefix: 'AST',
  prizes: prizeTable(771_790, [
    [2, 130_000],
    [4, 60_000],
    [10, 25_000],
    [20, 10_000],
    [50, 3_000],
    [500, 200],
    [5_000, 10],
  ]),

  generate(rng, prize) {
    const sign = pick(rng, ZODIAC_SIGNS);
    const others = ZODIAC_SIGNS.filter((candidate) => candidate !== sign);
    const sky: CellData[] = Array.from({ length: prize > 0 ? 11 : 12 }, () => {
      const [symbol, glyph] = pick(rng, others);
      return { symbol, label: glyph, amount: pick(rng, AMOUNTS) };
    });
    if (prize > 0) sky.push({ symbol: sign[0], label: sign[1], amount: prize });
    return [
      zone('ciel', 'Le ciel d’Astro', 'Chaque constellation portant votre signe vous rapporte le montant indiqué.', [
        group('ciel', 'signe', 'Votre signe', 1, [{ symbol: sign[0], label: `${sign[1]} ${sign[2]}` }]),
        group('ciel', 'constellations', 'Les constellations', 4, shuffle(sky, rng)),
      ]),
    ];
  },

  evaluate(zones) {
    const ciel = zoneById(zones, 'ciel');
    const sign = firstCell(ciel, 'signe');
    const matches = groupById(ciel, 'constellations').cells.filter((cell) => cell.symbol === sign.symbol);
    const amount = matches.reduce((sum, cell) => sum + (cell.amount ?? 0), 0);
    if (amount === 0) return ticketEvaluation([zoneResult('ciel', 0, 'Votre signe n’apparaît pas')]);
    return ticketEvaluation([zoneResult('ciel', amount, 'Votre signe brille dans le ciel', [sign.id, ...matches.map((cell) => cell.id)])]);
  },
};
