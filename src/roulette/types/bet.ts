import type { Chips } from '../../core/index.js';
import type { RouletteNumber, Third } from '../wheel/pockets.js';

/** Mises internes : Plein, Cheval, Transversale, Carré, Sixain. */
export const INSIDE_BET_KINDS = ['STRAIGHT', 'SPLIT', 'STREET', 'CORNER', 'SIX_LINE'] as const;
/** Mises externes : Colonne, Douzaine, Rouge/Noir, Pair/Impair, Manque/Passe. */
export const OUTSIDE_BET_KINDS = ['COLUMN', 'DOZEN', 'RED', 'BLACK', 'EVEN', 'ODD', 'LOW', 'HIGH'] as const;

export type InsideBetKind = (typeof INSIDE_BET_KINDS)[number];
export type OutsideBetKind = (typeof OUTSIDE_BET_KINDS)[number];
export type BetKind = InsideBetKind | OutsideBetKind;
export type BetFamily = 'INSIDE' | 'OUTSIDE';

/**
 * Ce que le joueur désigne sur le tapis. Le typage impose le bon nombre de numéros par type de mise ;
 * leur adjacence (1-2 oui, 1-5 non) est vérifiée contre le graphe des mises.
 */
export type BetSelection =
  | { readonly kind: 'STRAIGHT'; readonly numbers: readonly [number] }
  | { readonly kind: 'SPLIT'; readonly numbers: readonly [number, number] }
  | { readonly kind: 'STREET'; readonly numbers: readonly [number, number, number] }
  | { readonly kind: 'CORNER'; readonly numbers: readonly [number, number, number, number] }
  | { readonly kind: 'SIX_LINE'; readonly numbers: readonly [number, number, number, number, number, number] }
  | { readonly kind: 'COLUMN' | 'DOZEN'; readonly index: Third }
  | { readonly kind: 'RED' | 'BLACK' | 'EVEN' | 'ODD' | 'LOW' | 'HIGH' };

declare const betIdBrand: unique symbol;

/** Identifiant canonique d'une position du tapis : "STRAIGHT:17", "CORNER:1-2-4-5", "COLUMN:3", "RED". */
export type BetId = string & { readonly [betIdBrand]: 'BetId' };

/** Nœud du graphe des mises : une position du tapis et les numéros exacts qu'elle couvre. */
export interface BetDefinition {
  readonly id: BetId;
  readonly kind: BetKind;
  readonly family: BetFamily;
  /** Libellé français : "Carré 1-2-4-5", "Douzaine 2 (13-24)". */
  readonly label: string;
  /** Numéros couverts, triés par ordre croissant. */
  readonly covers: readonly RouletteNumber[];
  /** Gain net pour 1 jeton misé : 35 pour un plein (35:1). */
  readonly payout: number;
}

/** Jetons posés sur une position ; plusieurs poses sur la même position s'additionnent. */
export interface PlacedBet {
  readonly betId: BetId;
  readonly amount: Chips;
}
