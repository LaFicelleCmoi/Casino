import { EngineError, InvariantViolation } from '../errors.js';
import type { RandomSource } from '../random/random-source.js';
import { err, ok, type Result } from '../result.js';
import { RANKS, SUITS, card, type Card } from './card.js';
import type { ShoeState } from './shoe-state.js';
import { shuffle } from './shuffle.js';

export const MAX_DECKS = 8;

export interface ShoeConfig {
  readonly deckCount: number;
  /** Part du sabot distribuée avant la carte de coupe, dans ]0, 1]. 1 = pas de carte de coupe (Hold'em). */
  readonly penetration: number;
}

export interface Draw {
  readonly card: Card;
  readonly shoe: ShoeState;
}

export interface MultiDraw {
  readonly cards: readonly Card[];
  readonly shoe: ShoeState;
}

const exhausted = (message: string): EngineError => new EngineError('SHOE_EXHAUSTED', message);

export function validateShoeConfig(config: ShoeConfig): Result<ShoeConfig> {
  if (!Number.isInteger(config.deckCount) || config.deckCount < 1 || config.deckCount > MAX_DECKS) {
    return err(
      new EngineError('INVALID_RULES', `deckCount doit être un entier entre 1 et ${MAX_DECKS}`, {
        deckCount: config.deckCount,
      }),
    );
  }
  // Formulé en positif pour rejeter aussi NaN.
  if (!(config.penetration > 0 && config.penetration <= 1)) {
    return err(
      new EngineError('INVALID_RULES', 'penetration doit être dans ]0, 1]', { penetration: config.penetration }),
    );
  }
  return ok(config);
}

export function createOrderedCards(deckCount: number): Card[] {
  const cards: Card[] = [];
  for (let deck = 0; deck < deckCount; deck += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push(card(rank, suit));
      }
    }
  }
  return cards;
}

/** Hold'em : `createShoe({ deckCount: 1, penetration: 1 }, rng)` à chaque main. */
export function createShoe(config: ShoeConfig, rng: RandomSource): Result<ShoeState> {
  const validated = validateShoeConfig(config);
  if (!validated.ok) return validated;

  const cards = shuffle(createOrderedCards(config.deckCount), rng);
  return ok({
    deckCount: config.deckCount,
    cards,
    nextIndex: 0,
    roundStartIndex: 0,
    cutCardIndex: Math.floor(cards.length * config.penetration),
  });
}

export function cardsRemaining(shoe: ShoeState): number {
  return shoe.cards.length - shoe.nextIndex;
}

/** Vérifié entre deux manches uniquement : on ne remélange jamais au milieu d'une manche. */
export function isCutCardReached(shoe: ShoeState): boolean {
  return shoe.nextIndex >= shoe.cutCardIndex;
}

/** À appeler au début de chaque manche : délimite les cartes recyclables en cas d'épuisement. */
export function beginRound(shoe: ShoeState): ShoeState {
  return { ...shoe, roundStartIndex: shoe.nextIndex };
}

/** O(1) : le tableau de cartes est partagé, seul le curseur avance. */
export function drawCard(shoe: ShoeState): Result<Draw> {
  const next = shoe.cards[shoe.nextIndex];
  if (next === undefined) return err(exhausted('Le sabot est vide'));
  return ok({ card: next, shoe: { ...shoe, nextIndex: shoe.nextIndex + 1 } });
}

export function drawCards(shoe: ShoeState, count: number): Result<MultiDraw> {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new InvariantViolation(`Nombre de cartes invalide : ${count}`);
  }
  if (cardsRemaining(shoe) < count) {
    return err(exhausted(`${count} cartes demandées, ${cardsRemaining(shoe)} restantes`));
  }
  const end = shoe.nextIndex + count;
  return ok({ cards: shoe.cards.slice(shoe.nextIndex, end), shoe: { ...shoe, nextIndex: end } });
}

/** Brûle la carte du dessus (Hold'em : avant le flop, le turn et la river). */
export function burnCard(shoe: ShoeState): Result<ShoeState> {
  const drawn = drawCard(shoe);
  return drawn.ok ? ok(drawn.value.shoe) : drawn;
}

/**
 * Sabot épuisé en pleine manche (cas rare : nombreux splits avec peu de decks).
 * Les défausses des manches précédentes sont remélangées sous les cartes restantes ; les cartes en jeu restent en tête,
 * donc aucune carte n'est dupliquée. La carte de coupe est considérée atteinte : remélange complet à la manche suivante.
 */
export function recycleDiscards(shoe: ShoeState, rng: RandomSource): Result<ShoeState> {
  if (shoe.roundStartIndex === 0) {
    return err(exhausted('Sabot épuisé et aucune défausse à recycler'));
  }
  const inPlay = shoe.cards.slice(shoe.roundStartIndex, shoe.nextIndex);
  const undealt = shoe.cards.slice(shoe.nextIndex);
  const discards = shoe.cards.slice(0, shoe.roundStartIndex);

  return ok({
    deckCount: shoe.deckCount,
    cards: [...inPlay, ...undealt, ...shuffle(discards, rng)],
    nextIndex: inPlay.length,
    roundStartIndex: 0,
    cutCardIndex: inPlay.length,
  });
}

export function drawCardOrRecycle(shoe: ShoeState, rng: RandomSource): Result<Draw> {
  const drawn = drawCard(shoe);
  if (drawn.ok) return drawn;
  const recycled = recycleDiscards(shoe, rng);
  return recycled.ok ? drawCard(recycled.value) : recycled;
}
