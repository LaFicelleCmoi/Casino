import { describe, expect, it } from 'vitest';
import { STANDARD_BLACKJACK_RULES } from '../../src/blackjack/index.js';
import { cardFromCode } from '../../src/core/index.js';
import {
  DEFAULT_HOUSE,
  EMPTY_SERVICE,
  applyHouseRules,
  arrivalChance,
  betAppetite,
  departureChance,
  houseEdge,
  houseMood,
  parseHouseRules,
  perfectPair,
  serviceNote,
  speedFactor,
  tipAmount,
  tipChance,
  type HouseRules,
} from '../../web/blackjack-house.js';

const house = (patch: Partial<HouseRules>): HouseRules => ({ ...DEFAULT_HOUSE, ...patch });

describe('règles de la maison', () => {
  it('traduit les choix du croupier en règles du moteur', () => {
    const rules = applyHouseRules(STANDARD_BLACKJACK_RULES, house({ payout: '6:5', soft17: 'HIT', decks: 2, surrender: 'LATE', minBet: 25, maxBet: 5000 }));
    expect(rules.blackjackPayout).toEqual({ numerator: 6, denominator: 5 });
    expect(rules.dealerHitsSoft17).toBe(true);
    expect(rules.deckCount).toBe(2);
    expect(rules.surrender).toBe('LATE');
    expect([rules.minBet, rules.maxBet]).toEqual([25, 5000]);
    expect(rules.seatCount).toBe(STANDARD_BLACKJACK_RULES.seatCount);
  });

  it('refuse toute valeur hors des choix proposés et un maximum inférieur à 10 fois le minimum', () => {
    expect(parseHouseRules({ ...DEFAULT_HOUSE })).toEqual(DEFAULT_HOUSE);
    expect(parseHouseRules({ ...DEFAULT_HOUSE, payout: '2:1' })).toBeNull();
    expect(parseHouseRules({ ...DEFAULT_HOUSE, decks: 4 })).toBeNull();
    expect(parseHouseRules({ ...DEFAULT_HOUSE, minBet: 100, maxBet: 500 })).toBeNull();
    expect(parseHouseRules({ ...DEFAULT_HOUSE, serviceLength: undefined })).toBeNull();
    expect(parseHouseRules('règles')).toBeNull();
  });

  it('chiffre l’avantage de la maison règle par règle', () => {
    expect(houseEdge(DEFAULT_HOUSE)).toBe(0.4);
    expect(houseEdge(house({ payout: '6:5' }))).toBe(1.79);
    expect(houseEdge(house({ soft17: 'HIT', doubleAfterSplit: false }))).toBe(0.76);
    // Un seul jeu, abandon permis : ce sont les joueurs qui ont l'avantage.
    expect(houseEdge(house({ decks: 1, surrender: 'LATE' }))).toBeLessThan(0);
    expect(houseMood(house({ decks: 1 }))).toBe('GENEROUS');
    expect(houseMood(house({ payout: '1:1' }))).toBe('STINGY');
  });

  it('une maison serrée attire moins, fait fuir, fait miser petit et reçoit moins de pourboires', () => {
    const generous = house({ decks: 1 });
    const stingy = house({ payout: '6:5', soft17: 'HIT' });
    expect(arrivalChance(stingy)).toBeLessThan(arrivalChance(generous));
    expect(departureChance(stingy, false)).toBeGreaterThan(departureChance(generous, false));
    expect(departureChance(DEFAULT_HOUSE, true)).toBeGreaterThan(departureChance(DEFAULT_HOUSE, false));
    expect(betAppetite(stingy)).toBeLessThan(1);
    expect(betAppetite(generous)).toBeGreaterThan(1);
    expect(tipChance(stingy)).toBeLessThan(tipChance(generous));
    expect(arrivalChance(house({ minBet: 100, maxBet: 1000 }))).toBeLessThan(arrivalChance(DEFAULT_HOUSE));
  });

  it('récompense un croupier vif et paie les pourboires sur la mise', () => {
    expect(speedFactor(1000)).toBe(1.3);
    expect(speedFactor(6000)).toBe(0.6);
    expect(speedFactor(null)).toBe(1);
    expect(tipAmount(100, false)).toBe(5);
    expect(tipAmount(10, false)).toBe(1);
    expect(tipAmount(100, true)).toBe(10);
  });
});

describe('Paires parfaites', () => {
  it('distingue paire parfaite, de couleur et simple', () => {
    expect(perfectPair(cardFromCode('Qh'), cardFromCode('Qh'))).toBe('PERFECT');
    expect(perfectPair(cardFromCode('Qh'), cardFromCode('Qd'))).toBe('COLORED');
    expect(perfectPair(cardFromCode('Qh'), cardFromCode('Qs'))).toBe('MIXED');
    expect(perfectPair(cardFromCode('Qh'), cardFromCode('Kh'))).toBeNull();
  });
});

describe('note de service', () => {
  it('donne S à un service rapide, plein, généreux en pourboires et rentable', () => {
    const note = serviceNote(
      { ...EMPTY_SERVICE, rounds: 20, tips: 160, theo: 100, seatsFilled: 160, deals: 20, gestures: 40, gestureMs: 40_000 },
      10,
      8,
    );
    expect(note.parts.map((part) => part.points)).toEqual([100, 100, 100, 100]);
    expect(note.grade).toBe('S');
  });

  it('une table généreuse en pourboires mais sans gain théorique plafonne au B', () => {
    const note = serviceNote(
      { ...EMPTY_SERVICE, rounds: 20, tips: 160, theo: 30, seatsFilled: 160, deals: 20, gestures: 40, gestureMs: 80_000 },
      10,
      8,
    );
    expect(note.parts.map((part) => part.points)).toEqual([75, 100, 100, 30]);
    expect(note.grade).toBe('B');
  });

  it('sanctionne la lenteur, la table vide et un gain théorique négatif', () => {
    const note = serviceNote(
      { ...EMPTY_SERVICE, rounds: 10, tips: 0, theo: -5, seatsFilled: 20, deals: 10, gestures: 10, gestureMs: 60_000 },
      10,
      8,
    );
    expect(note.parts.map((part) => part.points)).toEqual([0, 25, 0, 0]);
    expect(note.score).toBe(6);
    expect(note.grade).toBe('D');
  });
});
