import type { BetKind } from '../types/bet.js';

/**
 * Rapports de gain (gain net pour 1 jeton misé). Tous valent 36 / n − 1 pour n numéros couverts :
 * les paiements sont « justes » sur 36 numéros, c'est le 37e — le zéro — qui fait l'avantage de la maison (1/37 ≈ 2,70 %).
 */
export const PAYOUT_TABLE = {
  STRAIGHT: 35,
  SPLIT: 17,
  STREET: 11,
  CORNER: 8,
  SIX_LINE: 5,
  COLUMN: 2,
  DOZEN: 2,
  RED: 1,
  BLACK: 1,
  EVEN: 1,
  ODD: 1,
  LOW: 1,
  HIGH: 1,
} as const satisfies Readonly<Record<BetKind, number>>;

/** Nombre de numéros que chaque type de mise doit couvrir : vérifié à la construction du graphe. */
export const COVERAGE_SIZE = {
  STRAIGHT: 1,
  SPLIT: 2,
  STREET: 3,
  CORNER: 4,
  SIX_LINE: 6,
  COLUMN: 12,
  DOZEN: 12,
  RED: 18,
  BLACK: 18,
  EVEN: 18,
  ODD: 18,
  LOW: 18,
  HIGH: 18,
} as const satisfies Readonly<Record<BetKind, number>>;
