import { describe, expect, it } from 'vitest';
import {
  CARDS_PER_DECK,
  EngineError,
  card,
  cardCode,
  chips,
  isChips,
  parseCard,
  rankIndex,
  sameCard,
} from '../../src/core/index.js';

describe('Card', () => {
  it('interne les cartes : une seule instance par couple rang/enseigne', () => {
    expect(card('A', 'spades')).toBe(card('A', 'spades'));
    expect(Object.isFrozen(card('A', 'spades'))).toBe(true);
  });

  it('fait l’aller-retour code ↔ carte', () => {
    const parsed = parseCard('Td');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual({ rank: 'T', suit: 'diamonds' });
      expect(cardCode(parsed.value)).toBe('Td');
    }
  });

  it('refuse un code invalide sans lever d’exception', () => {
    const parsed = parseCard('1x');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe('INVALID_CARD');
  });

  it('compare par valeur une carte désérialisée', () => {
    const fromJson = JSON.parse(JSON.stringify(card('K', 'hearts')));
    expect(sameCard(fromJson, card('K', 'hearts'))).toBe(true);
  });

  it('ordonne les rangs du 2 à l’As', () => {
    expect(rankIndex('2')).toBe(0);
    expect(rankIndex('A')).toBe(12);
    expect(CARDS_PER_DECK).toBe(52);
  });
});

describe('Chips', () => {
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])('rejette %s', (value) => {
    expect(isChips(value)).toBe(false);
    expect(() => chips(value)).toThrow(EngineError);
  });

  it('accepte les entiers positifs ou nuls', () => {
    expect(chips(0)).toBe(0);
    expect(chips(1_000)).toBe(1_000);
  });
});
