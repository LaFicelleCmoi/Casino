import type { Card } from './card.js';

/**
 * État sérialisable d'un sabot (1 deck pour le Hold'em, N decks pour le Blackjack).
 * Les cartes ne sont jamais recopiées pendant la manche : un tirage avance seulement `nextIndex`.
 * Création, mélange et tirage : Étape 2.
 */
export interface ShoeState {
  readonly deckCount: number;
  /** Ordre de tirage figé au mélange. Ne doit JAMAIS sortir du serveur (cf. projections). */
  readonly cards: readonly Card[];
  readonly nextIndex: number;
  /** Première carte de la manche en cours : tout ce qui précède est une défausse recyclable si le sabot s'épuise. */
  readonly roundStartIndex: number;
  /** Carte de coupe : une fois atteinte, remélange avant la manche suivante (jamais en cours de manche). */
  readonly cutCardIndex: number;
}
