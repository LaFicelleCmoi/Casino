import { EngineError, invariant } from '../errors.js';
import { err, ok, type Result } from '../result.js';

export const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
export type Suit = (typeof SUITS)[number];

/** Ordre croissant de force au poker. 'T' = 10 (notation standard sur 1 caractère). */
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export type Rank = (typeof RANKS)[number];

const SUIT_SYMBOLS = {
  clubs: 'c',
  diamonds: 'd',
  hearts: 'h',
  spades: 's',
} as const satisfies Record<Suit, string>;

export type SuitSymbol = (typeof SUIT_SYMBOLS)[Suit];

/** Notation compacte : "As" = As de pique, "Td" = 10 de carreau. Sert aux logs, tests, replays et au réseau. */
export type CardCode = `${Rank}${SuitSymbol}`;

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

/** Carte telle qu'un spectateur la voit : une face cachée ne transporte AUCUNE information exploitable. */
export type VisibleCard = { readonly faceUp: true; readonly card: Card } | { readonly faceUp: false };

export const CARDS_PER_DECK = SUITS.length * RANKS.length;

function toCode(rank: Rank, suit: Suit): CardCode {
  return `${rank}${SUIT_SYMBOLS[suit]}`;
}

/** Table d'interning : 52 instances gelées partagées par tous les sabots (zéro allocation par tirage). */
const CARD_BY_CODE: ReadonlyMap<CardCode, Card> = new Map<CardCode, Card>(
  SUITS.flatMap((suit) => RANKS.map((rank) => [toCode(rank, suit), Object.freeze({ rank, suit })] as const)),
);

export function cardFromCode(code: CardCode): Card {
  const found = CARD_BY_CODE.get(code);
  invariant(found !== undefined, `Code carte inconnu : ${code}`);
  return found;
}

export function card(rank: Rank, suit: Suit): Card {
  return cardFromCode(toCode(rank, suit));
}

export function cardCode(c: Card): CardCode {
  return toCode(c.rank, c.suit);
}

export function isCardCode(value: string): value is CardCode {
  return CARD_BY_CODE.has(value as CardCode);
}

/** Point d'entrée pour une donnée externe (client, fichier de replay) : erreur métier, jamais de crash. */
export function parseCard(value: string): Result<Card> {
  return isCardCode(value)
    ? ok(cardFromCode(value))
    : err(new EngineError('INVALID_CARD', `Carte invalide : "${value}"`));
}

/** Égalité par valeur : fiable même pour des cartes désérialisées (donc non internées). */
export function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

/** 0 pour '2' … 12 pour 'A'. */
export function rankIndex(rank: Rank): number {
  return RANKS.indexOf(rank);
}
