import { describe, expect, it } from 'vitest';
import { chips, playerId } from '../../src/core/index.js';
import {
  STANDARD_BLACKJACK_RULES,
  canDouble,
  canHit,
  canSplit,
  canSurrender,
  dealerShouldHit,
  resolveOutcome,
  scoreCards,
  type BlackjackSeat,
  type HandId,
  type PlayerHand,
} from '../../src/blackjack/index.js';
import { cards } from '../helpers.js';

const rules = STANDARD_BLACKJACK_RULES;

function hand(notation: string, overrides: Partial<PlayerHand> = {}): PlayerHand {
  return {
    id: 'h' as HandId,
    cards: cards(notation),
    bet: chips(10),
    status: 'PLAYING',
    fromSplit: false,
    isSplitAces: false,
    box: 0,
    ...overrides,
  };
}

function seatWith(hands: PlayerHand[]): BlackjackSeat {
  return {
    seatIndex: 0,
    player: { id: playerId('p'), displayName: 'P' },
    bankroll: chips(1_000),
    pendingBets: [],
    hands,
    insurance: { status: 'NOT_OFFERED' },
  };
}

describe('scoreCards', () => {
  it.each([
    ['As 6d', 17, true],
    ['As 6d Td', 17, false],
    ['As Ad 9c', 21, true],
    ['As Ad Ac Ah', 14, true],
    ['Kd Qc 5h', 25, false],
  ])('%s → %i (soft : %s)', (notation, total, isSoft) => {
    const score = scoreCards(cards(notation));
    expect(score.total).toBe(total);
    expect(score.isSoft).toBe(isSoft);
    expect(score.isBust).toBe(total > 21);
  });

  it('reconnaît le Blackjack naturel, mais pas après un split', () => {
    expect(scoreCards(cards('As Kd')).isBlackjack).toBe(true);
    expect(scoreCards(cards('As Kd'), true).isBlackjack).toBe(false);
    expect(scoreCards(cards('7s 7d 7c')).isBlackjack).toBe(false);
  });
});

describe('IA du croupier', () => {
  it('reste sur soft 17 en S17 et tire en H17', () => {
    const soft17 = scoreCards(cards('As 6d'));
    expect(dealerShouldHit(soft17, rules)).toBe(false);
    expect(dealerShouldHit(soft17, { ...rules, dealerHitsSoft17: true })).toBe(true);
  });

  it('tire sous 17 et reste sur hard 17', () => {
    expect(dealerShouldHit(scoreCards(cards('Ts 6d')), rules)).toBe(true);
    expect(dealerShouldHit(scoreCards(cards('Ts 7d')), rules)).toBe(false);
  });
});

describe('actions permises', () => {
  it('autorise le Double Down uniquement sur 2 cartes', () => {
    expect(canDouble(hand('5s 6d'), rules)).toBe(true);
    expect(canDouble(hand('2s 3d 6c'), rules)).toBe(false);
    expect(canDouble(hand('5s 6d', { fromSplit: true }), { ...rules, doubleAfterSplit: false })).toBe(false);
    expect(canDouble(hand('As 6d'), { ...rules, doubleRestriction: 'TEN_OR_ELEVEN' })).toBe(false);
  });

  it('autorise le split de deux cartes de même valeur selon la règle', () => {
    const jackKing = hand('Js Kd');
    expect(canSplit(seatWith([jackKing]), jackKing, rules)).toBe(true);
    expect(canSplit(seatWith([jackKing]), jackKing, { ...rules, splitMatching: 'SAME_RANK' })).toBe(false);
  });

  it('refuse le split au-delà du nombre maximal de mains d’une case', () => {
    const pair = hand('8s 8d');
    expect(canSplit(seatWith([pair, hand('8c 2d'), hand('8h 3d'), hand('4s 5d')]), pair, rules)).toBe(false);
  });

  it('compte cette limite case par case', () => {
    const pair = hand('8s 8d');
    const otherBox = { box: 1 };
    expect(canSplit(seatWith([pair, hand('8c 2d', otherBox), hand('8h 3d', otherBox), hand('4s 5d', otherBox)]), pair, rules)).toBe(true);
  });

  it('bloque un As splitté après sa carte unique', () => {
    expect(canHit(hand('As 5d', { fromSplit: true, isSplitAces: true }), rules)).toBe(false);
  });

  it('n’autorise le surrender qu’avec la règle LATE, sur la main initiale de sa case', () => {
    const initial = hand('Ts 6d');
    expect(canSurrender(seatWith([initial]), initial, rules)).toBe(false);
    expect(canSurrender(seatWith([initial]), initial, { ...rules, surrender: 'LATE' })).toBe(true);
    expect(canSurrender(seatWith([initial, hand('9s 7d', { box: 1 })]), initial, { ...rules, surrender: 'LATE' })).toBe(true);
  });
});

describe('resolveOutcome', () => {
  const dealer = (notation: string) => scoreCards(cards(notation));

  it.each([
    ['As Kd', 'Ts 9d', 'BLACKJACK'],
    ['As Kd', 'Ah Qd', 'PUSH'],
    ['Ts 9d', 'Ah Qd', 'LOSS'],
    ['Ts 9d', 'Th 6d 8c', 'WIN'],
    ['Ts 6d 8c', 'Th 6d 8c', 'LOSS'],
    ['Ts 8d', 'Th 8c', 'PUSH'],
    ['Ts 9d', 'Th 8c', 'WIN'],
  ])('joueur %s contre croupier %s → %s', (player, dealerCards, outcome) => {
    expect(resolveOutcome(hand(player), dealer(dealerCards))).toBe(outcome);
  });

  it('un 21 après split ne bat pas un Blackjack et ne paie pas 3:2', () => {
    expect(resolveOutcome(hand('As Kd', { fromSplit: true }), dealer('Ts 9d'))).toBe('WIN');
  });
});
