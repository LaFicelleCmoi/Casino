import type { Chips } from '../../core/index.js';

export const RACE_BET_KINDS = ['GAGNANT', 'PLACE', 'TIERCE_ORDRE', 'TIERCE_DESORDRE', 'QUINTE_ORDRE', 'QUINTE_DESORDRE'] as const;
export type RaceBetKind = (typeof RACE_BET_KINDS)[number];

/** État du terrain : influence la vitesse de la course. */
export type Going = 'BON' | 'SOUPLE' | 'LOURD';

export interface Horse {
  /** Numéro de dossard, de 1 au nombre de partants. */
  readonly number: number;
  readonly name: string;
  readonly jockey: string;
  /** Couleur de casaque (CSS). */
  readonly silk: string;
  /** Cinq dernières performances, la plus récente en tête : "1p 4p 2p 7p 3p". */
  readonly form: string;
  /** Force du modèle de Plackett-Luce : entier strictement positif. */
  readonly strength: number;
}

/** Cote en centièmes : 350 = 3,50 (10 jetons misés en rapportent 35, mise comprise). */
export type OddsCents = number;

export interface HorseOdds {
  readonly number: number;
  readonly win: OddsCents;
  readonly place: OddsCents;
}

export interface RaceCard {
  readonly raceNumber: number;
  readonly hippodrome: string;
  /** En mètres. */
  readonly distance: number;
  readonly going: Going;
  readonly horses: readonly Horse[];
  readonly odds: readonly HorseOdds[];
}

export interface FinishTime {
  readonly number: number;
  readonly centiseconds: number;
}

/** Arrivée scellée dès la programmation de la course, révélée au départ. */
export interface RaceResult {
  /** Numéros des chevaux dans l'ordre d'arrivée. */
  readonly order: readonly number[];
  /** Chronos dans l'ordre d'arrivée. */
  readonly times: readonly FinishTime[];
}

export type RaceBetSelection =
  | { readonly kind: 'GAGNANT' | 'PLACE'; readonly horses: readonly [number] }
  | { readonly kind: 'TIERCE_ORDRE' | 'TIERCE_DESORDRE'; readonly horses: readonly [number, number, number] }
  | { readonly kind: 'QUINTE_ORDRE' | 'QUINTE_DESORDRE'; readonly horses: readonly [number, number, number, number, number] };

export interface PlacedRaceBet {
  readonly id: string;
  readonly kind: RaceBetKind;
  readonly horses: readonly number[];
  readonly stake: Chips;
  /** Cote figée au moment du pari. */
  readonly odds: OddsCents;
}

export interface RaceBetSettlement {
  readonly bet: PlacedRaceBet;
  readonly won: boolean;
  /** Mise comprise : 0 si le pari est perdu. */
  readonly payout: Chips;
  readonly net: number;
}
