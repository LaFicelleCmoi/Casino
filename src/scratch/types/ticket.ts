import type { Chips, RandomSource } from '../../core/index.js';

export const TICKET_TYPES = [
  'BANCO',
  'CASH',
  'MORPION',
  'MILLIONNAIRE',
  'VEGAS',
  'MOTS_CROISES',
  'MAXI_MOTS_CROISES',
  'MEGA_MOTS_CROISES',
  'ASTRO',
  'POLE_POSITION',
] as const;

export type TicketTypeId = (typeof TICKET_TYPES)[number];

/** Case recouverte de pellicule : ce qui est imprimé dessous. */
export interface ScratchCell {
  /** Unique sur le ticket : "zone.groupe.index". */
  readonly id: string;
  /** Code machine lu par l'évaluateur : "AMOUNT", "X", "GREEN_LIGHT", "LETTER"… */
  readonly symbol: string;
  /** Texte imprimé : "50", "✕", "01:24:53"… */
  readonly label: string;
  readonly amount: Chips | null;
  /** Valeur numérique éventuelle : numéro tiré, face de dé, chrono en centièmes… */
  readonly value: number | null;
}

/** Sous-ensemble de cases d'une zone : « Numéros gagnants », « Vos numéros », « Gain »… */
export interface CellGroup {
  readonly id: string;
  readonly label: string;
  readonly columns: number;
  readonly cells: readonly ScratchCell[];
}

export type WordDirection = 'ACROSS' | 'DOWN';

export interface PlacedWord {
  readonly word: string;
  readonly row: number;
  readonly column: number;
  readonly direction: WordDirection;
}

/** Grille de mots croisés imprimée à découvert sur le ticket. */
export interface CrosswordBoard {
  readonly width: number;
  readonly height: number;
  readonly words: readonly PlacedWord[];
}

/** Mini-jeu du ticket. */
export interface ScratchZone {
  readonly id: string;
  readonly title: string;
  readonly rule: string;
  readonly groups: readonly CellGroup[];
  /** Partie visible sans gratter (grille de mots croisés), sinon null. */
  readonly board: CrosswordBoard | null;
}

export interface ZoneResult {
  readonly zoneId: string;
  readonly won: boolean;
  /** Gain de la zone avant multiplicateur. */
  readonly amount: Chips;
  readonly detail: string;
  /** Éléments gagnants à mettre en valeur : ids de cases, ou "word:<index>" pour un mot de la grille. */
  readonly marks: readonly string[];
}

export interface TicketEvaluation {
  readonly zones: readonly ZoneResult[];
  /** ×1, ou ×5 avec le Pit-Stop Bonus. */
  readonly multiplier: number;
  /** Σ gains des zones × multiplicateur. */
  readonly total: Chips;
}

export interface Ticket {
  readonly serial: string;
  readonly type: TicketTypeId;
  readonly price: Chips;
  readonly zones: readonly ScratchZone[];
  /** Ids des cases déjà grattées. */
  readonly scratched: readonly string[];
  /** Fixée à l'impression : gratter ne fait que la découvrir. */
  readonly evaluation: TicketEvaluation;
}

export interface PrizeTier {
  readonly amount: Chips;
  readonly weight: number;
}

/** Plan de lots : probabilité d'un palier = poids / (loseWeight + Σ poids). */
export interface PrizeTable {
  readonly loseWeight: number;
  readonly tiers: readonly PrizeTier[];
}

/**
 * Un jeu de grattage. Le lot est tiré AVANT l'impression (comme pour un vrai ticket) ; `generate` imprime une grille
 * qui produit exactement ce lot et `evaluate` relit la grille indépendamment, pour que le moteur vérifie leur accord.
 */
export interface ScratchGameDefinition {
  readonly type: TicketTypeId;
  readonly name: string;
  readonly tagline: string;
  readonly price: Chips;
  readonly serialPrefix: string;
  readonly prizes: PrizeTable;
  generate(rng: RandomSource, prize: Chips): readonly ScratchZone[];
  evaluate(zones: readonly ScratchZone[]): TicketEvaluation;
}
