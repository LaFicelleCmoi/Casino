import { describe, expect, it } from 'vitest';
import { chips, playerId } from '../../src/core/index.js';
import { HoldemBetManager, STANDARD_HOLDEM_RULES, validateHoldemRules } from '../../src/holdem/index.js';
import { expectError, unwrap } from '../helpers.js';
import { bettingRound, pokerSeat } from './fixtures.js';

const manager = new HoldemBetManager(STANDARD_HOLDEM_RULES); // blindes 5/10
const ctx = { opponentsWithChips: 2 };
const p0 = playerId('p0');

describe('actions légales', () => {
  it('donne son option à la big blind préflop', () => {
    const bigBlind = pokerSeat(0, { stack: chips(990), streetBet: chips(10), totalCommitted: chips(10) });
    expect(manager.legalActions(bigBlind, bettingRound(10), ctx)).toEqual({
      canFold: true,
      canCheck: true,
      callAmount: null,
      bet: null,
      raise: { min: 20, max: 1_000 },
      allInAmount: 990,
    });
  });

  it('propose une ouverture quand personne n’a misé', () => {
    const legal = manager.legalActions(pokerSeat(0), bettingRound(0), ctx);
    expect(legal?.bet).toEqual({ min: 10, max: 1_000 });
    expect(legal?.raise).toBeNull();
    expect(legal?.canCheck).toBe(true);
  });

  it('refuse d’agir hors de son tour', () => {
    expect(manager.legalActions(pokerSeat(0), bettingRound(10, 10, 3), ctx)).toBeNull();
    expectError(manager.apply(pokerSeat(0), bettingRound(10, 10, 3), { type: 'CALL', playerId: p0 }, ctx), 'NOT_YOUR_TURN');
  });

  it('refuse une action émise par un autre joueur que celui du siège', () => {
    expectError(
      manager.apply(pokerSeat(0), bettingRound(10), { type: 'CALL', playerId: playerId('intrus') }, ctx),
      'NOT_YOUR_TURN',
    );
  });

  it('interdit de checker face à une mise', () => {
    expectError(manager.apply(pokerSeat(0), bettingRound(100), { type: 'CHECK', playerId: p0 }, ctx), 'ILLEGAL_ACTION');
  });

  it('interdit toute relance quand aucun adversaire ne peut suivre', () => {
    const legal = manager.legalActions(pokerSeat(0), bettingRound(100), { opponentsWithChips: 0 });
    expect(legal?.raise).toBeNull();
    expect(legal?.allInAmount).toBeNull();
    expect(legal?.callAmount).toBe(100);
  });
});

describe('relances', () => {
  it('une relance complète fixe la nouvelle relance minimale', () => {
    const result = unwrap(
      manager.apply(pokerSeat(0), bettingRound(10), { type: 'RAISE', playerId: p0, raiseTo: chips(30) }, ctx),
    );
    expect(result.round).toMatchObject({ currentBet: 30, minRaise: 20, lastAggressor: 0 });
    expect(result.seat).toMatchObject({ stack: 970, streetBet: 30, totalCommitted: 30, hasActed: true, lastAction: 'RAISE' });
    expect(result.isFullRaise).toBe(true);
  });

  it('refuse une relance sous le minimum', () => {
    expectError(
      manager.apply(pokerSeat(0), bettingRound(10), { type: 'RAISE', playerId: p0, raiseTo: chips(15) }, ctx),
      'BET_OUT_OF_LIMITS',
    );
  });

  it('un all-in court isolé ne rouvre pas l’action à un joueur ayant déjà parlé', () => {
    const alreadyActed = pokerSeat(0, { hasActed: true, streetBet: chips(100), totalCommitted: chips(100), stack: chips(900) });
    const facingShortAllIn = bettingRound(150, 100); // 100 → 150 : +50 < relance minimale de 100

    const legal = manager.legalActions(alreadyActed, facingShortAllIn, ctx);
    expect(legal).toMatchObject({ callAmount: 50, raise: null, allInAmount: null });
    expectError(
      manager.apply(alreadyActed, facingShortAllIn, { type: 'RAISE', playerId: p0, raiseTo: chips(250) }, ctx),
      'ILLEGAL_ACTION',
    );
  });

  it('plusieurs all-in courts cumulés rouvrent l’action (règle TDA)', () => {
    const alreadyActed = pokerSeat(0, { hasActed: true, streetBet: chips(100), totalCommitted: chips(100), stack: chips(900) });
    // 100 → 150 → 220 : +120 depuis sa dernière action, soit au moins une relance complète.
    expect(manager.legalActions(alreadyActed, bettingRound(220, 100), ctx)?.raise).toEqual({ min: 320, max: 1_000 });
  });

  it('un all-in inférieur à une relance complète élève la mise sans changer la relance minimale', () => {
    const shortStack = pokerSeat(0, { stack: chips(150) });
    const round = bettingRound(100, 100);
    expect(manager.legalActions(shortStack, round, ctx)).toMatchObject({ raise: null, allInAmount: 150 });

    const result = unwrap(manager.apply(shortStack, round, { type: 'ALL_IN', playerId: p0 }, ctx));
    expect(result.round).toMatchObject({ currentBet: 150, minRaise: 100, lastAggressor: null });
    expect(result.isFullRaise).toBe(false);
    expect(result.seat.status).toBe('ALL_IN');
  });

  it('un call pour tout son stack passe le joueur all-in sans toucher au tour d’enchères', () => {
    const shortStack = pokerSeat(0, { stack: chips(40) });
    const round = bettingRound(100);
    expect(manager.legalActions(shortStack, round, ctx)).toMatchObject({ callAmount: 40, allInAmount: 40, raise: null });

    const result = unwrap(manager.apply(shortStack, round, { type: 'CALL', playerId: p0 }, ctx));
    expect(result.isAllIn).toBe(true);
    expect(result.seat.status).toBe('ALL_IN');
    expect(result.round).toBe(round);
  });
});

describe('mises forcées et ouverture de street', () => {
  it('poste une big blind short all-in sans consommer l’option', () => {
    const forced = manager.postBlind(pokerSeat(0, { stack: chips(6) }), chips(10));
    expect(forced.posted).toBe(6);
    expect(forced.isAllIn).toBe(true);
    expect(forced.seat).toMatchObject({ status: 'ALL_IN', streetBet: 6, totalCommitted: 6, hasActed: false });
  });

  it('compte l’ante dans le pot mais pas dans la mise à suivre', () => {
    const forced = manager.postAnte(pokerSeat(0), chips(5));
    expect(forced.seat).toMatchObject({ stack: 995, streetBet: 0, totalCommitted: 5 });
  });

  it('ouvre le préflop à hauteur de la big blind et les streets suivantes à zéro', () => {
    expect(manager.openRound('PREFLOP', 3)).toEqual({ toAct: 3, currentBet: 10, minRaise: 10, lastAggressor: null });
    expect(manager.openRound('FLOP', 1).currentBet).toBe(0);
  });
});

describe('validateHoldemRules', () => {
  it('accepte les règles standard', () => {
    expect(validateHoldemRules(STANDARD_HOLDEM_RULES).ok).toBe(true);
  });

  it('refuse une big blind inférieure à la small blind', () => {
    expectError(validateHoldemRules({ ...STANDARD_HOLDEM_RULES, bigBlind: chips(2) }), 'INVALID_RULES');
  });
});
