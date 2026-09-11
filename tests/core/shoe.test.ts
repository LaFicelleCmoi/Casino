import { describe, expect, it } from 'vitest';
import {
  SeededRandomSource,
  beginRound,
  burnCard,
  cardCode,
  cardsRemaining,
  createShoe,
  drawCard,
  drawCardOrRecycle,
  drawCards,
  isCutCardReached,
  recycleDiscards,
  validateShoeConfig,
  type ShoeState,
} from '../../src/core/index.js';
import { expectError, unwrap } from '../helpers.js';

const singleDeck = (penetration = 0.5): ShoeState =>
  unwrap(createShoe({ deckCount: 1, penetration }, new SeededRandomSource('single-deck')));

describe('createShoe', () => {
  it('assemble et mélange un sabot de 6 decks', () => {
    const shoe = unwrap(createShoe({ deckCount: 6, penetration: 0.75 }, new SeededRandomSource('six')));
    const counts = new Map<string, number>();
    for (const c of shoe.cards) counts.set(cardCode(c), (counts.get(cardCode(c)) ?? 0) + 1);

    expect(shoe.cards).toHaveLength(312);
    expect(shoe.cutCardIndex).toBe(234);
    expect(counts.size).toBe(52);
    expect([...counts.values()].every((count) => count === 6)).toBe(true);
  });

  it('produit le même ordre avec la même seed', () => {
    const config = { deckCount: 2, penetration: 1 };
    const a = unwrap(createShoe(config, new SeededRandomSource(7)));
    const b = unwrap(createShoe(config, new SeededRandomSource(7)));
    expect(a.cards).toEqual(b.cards);
  });

  it.each([
    { deckCount: 0, penetration: 0.5 },
    { deckCount: 9, penetration: 0.5 },
    { deckCount: 2.5, penetration: 0.5 },
    { deckCount: 1, penetration: 0 },
    { deckCount: 1, penetration: 1.2 },
    { deckCount: 1, penetration: Number.NaN },
  ])('rejette la configuration %o', (config) => {
    expectError(validateShoeConfig(config), 'INVALID_RULES');
  });
});

describe('tirage', () => {
  it('avance le curseur sans recopier ni muter le sabot', () => {
    const shoe = singleDeck();
    const drawn = unwrap(drawCard(shoe));
    expect(drawn.card).toBe(shoe.cards[0]);
    expect(drawn.shoe.nextIndex).toBe(1);
    expect(drawn.shoe.cards).toBe(shoe.cards);
    expect(shoe.nextIndex).toBe(0);
    expect(cardsRemaining(drawn.shoe)).toBe(51);
  });

  it('brûle la carte du dessus', () => {
    expect(unwrap(burnCard(singleDeck())).nextIndex).toBe(1);
  });

  it('signale la carte de coupe', () => {
    expect(isCutCardReached(unwrap(drawCards(singleDeck(), 25)).shoe)).toBe(false);
    expect(isCutCardReached(unwrap(drawCards(singleDeck(), 26)).shoe)).toBe(true);
  });

  it('refuse de tirer plus de cartes que le sabot n’en contient', () => {
    expectError(drawCards(singleDeck(), 53), 'SHOE_EXHAUSTED');
  });
});

describe('recyclage des défausses', () => {
  const exhaustedMidRound = () => {
    const rng = new SeededRandomSource('recycle');
    const previousRounds = unwrap(drawCards(unwrap(createShoe({ deckCount: 1, penetration: 1 }, rng)), 40)).shoe;
    const currentRound = unwrap(drawCards(beginRound(previousRounds), 12));
    return { rng, inPlay: currentRound.cards, shoe: currentRound.shoe };
  };

  it('remélange les défausses sous les cartes en jeu, sans doublon', () => {
    const { rng, inPlay, shoe } = exhaustedMidRound();
    expectError(drawCard(shoe), 'SHOE_EXHAUSTED');

    const recycled = unwrap(recycleDiscards(shoe, rng));
    expect(recycled.cards.slice(0, 12)).toEqual(inPlay);
    expect(recycled.nextIndex).toBe(12);
    expect(new Set(recycled.cards.map(cardCode)).size).toBe(52);
    expect(cardsRemaining(recycled)).toBe(40);
    expect(isCutCardReached(recycled)).toBe(true);
  });

  it('recycle automatiquement lors d’un tirage sur sabot vide', () => {
    const { rng, shoe } = exhaustedMidRound();
    expect(unwrap(drawCardOrRecycle(shoe, rng)).shoe.nextIndex).toBe(13);
  });

  it('échoue s’il n’existe aucune défausse', () => {
    const shoe = unwrap(drawCards(singleDeck(1), 52)).shoe;
    expectError(recycleDiscards(shoe, new SeededRandomSource(0)), 'SHOE_EXHAUSTED');
  });
});
