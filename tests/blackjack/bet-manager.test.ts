import { describe, expect, it } from 'vitest';
import { ZERO_CHIPS, chips, playerId } from '../../src/core/index.js';
import {
  BlackjackBetManager,
  STANDARD_BLACKJACK_RULES,
  validateBlackjackRules,
  type BlackjackSeat,
  type HandId,
  type HandOutcome,
  type PlayerHand,
} from '../../src/blackjack/index.js';
import { expectError, unwrap } from '../helpers.js';

const manager = new BlackjackBetManager(STANDARD_BLACKJACK_RULES);

function hand(bet: number): PlayerHand {
  return { id: 'h1' as HandId, cards: [], bet: chips(bet), status: 'PLAYING', fromSplit: false, isSplitAces: false };
}

function seat(overrides: Partial<BlackjackSeat> = {}): BlackjackSeat {
  return {
    seatIndex: 0,
    player: { id: playerId('alice'), displayName: 'Alice' },
    bankroll: chips(500),
    pendingBet: ZERO_CHIPS,
    hands: [],
    insurance: { status: 'NOT_OFFERED' },
    ...overrides,
  };
}

describe('mises initiales', () => {
  it('refuse une première mise sous le minimum de table', () => {
    expectError(manager.placeBet(seat(), 5), 'BET_OUT_OF_LIMITS');
  });

  it('cumule les jetons posés et les débite du bankroll', () => {
    const afterFirst = unwrap(manager.placeBet(seat(), 10));
    const afterSecond = unwrap(manager.placeBet(afterFirst, 1));
    expect(afterSecond.pendingBet).toBe(11);
    expect(afterSecond.bankroll).toBe(489);
  });

  it('plafonne le total au maximum de table', () => {
    expectError(manager.placeBet(seat({ bankroll: chips(5_000), pendingBet: chips(1_000) }), 1), 'BET_OUT_OF_LIMITS');
  });

  it('refuse une mise supérieure au bankroll', () => {
    expectError(manager.placeBet(seat({ bankroll: chips(50) }), 100), 'INSUFFICIENT_FUNDS');
  });

  it.each([0, -10, 12.5, Number.NaN])('refuse le montant %s', (amount) => {
    expectError(manager.placeBet(seat(), amount), 'INVALID_AMOUNT');
  });

  it('rembourse intégralement une mise annulée', () => {
    const cleared = manager.clearBet(seat({ bankroll: chips(490), pendingBet: chips(10) }));
    expect(cleared.bankroll).toBe(500);
    expect(cleared.pendingBet).toBe(0);
  });

  it('ne propose aucune mise quand le bankroll est sous le minimum', () => {
    expect(manager.betRange(seat({ bankroll: chips(5) }))).toBeNull();
  });
});

describe('Double Down et Split', () => {
  it('double la mise de la main visée', () => {
    const doubled = unwrap(manager.doubleDown(seat({ bankroll: chips(100), hands: [hand(100)] }), 0));
    expect(doubled.bankroll).toBe(0);
    expect(doubled.hands[0]?.bet).toBe(200);
  });

  it('refuse un Double Down non couvert par le bankroll', () => {
    expectError(manager.doubleDown(seat({ bankroll: chips(99), hands: [hand(100)] }), 0), 'INSUFFICIENT_FUNDS');
  });

  it('réserve la mise de la main issue d’un split', () => {
    const { seat: debited, stake } = unwrap(manager.reserveHandStake(seat({ hands: [hand(40)] }), 0));
    expect(stake).toBe(40);
    expect(debited.bankroll).toBe(460);
  });

  it('refuse une main inexistante', () => {
    expectError(manager.reserveHandStake(seat({ hands: [hand(40)] }), 3), 'ILLEGAL_ACTION');
  });
});

describe('assurance', () => {
  const pending = seat({ hands: [hand(25)], insurance: { status: 'PENDING' } });

  it('prélève la moitié arrondie à l’inférieur de la mise initiale', () => {
    const insured = unwrap(manager.takeInsurance(pending));
    expect(insured.bankroll).toBe(488);
    expect(insured.insurance).toEqual({ status: 'TAKEN', stake: 12 });
  });

  it('refuse une seconde décision', () => {
    expectError(manager.takeInsurance(unwrap(manager.takeInsurance(pending))), 'ILLEGAL_ACTION');
    expectError(manager.declineInsurance(unwrap(manager.declineInsurance(pending))), 'ILLEGAL_ACTION');
  });

  it('paie 2:1 uniquement si le croupier a Blackjack', () => {
    expect(manager.insuranceReturned(chips(12), true)).toBe(36);
    expect(manager.insuranceReturned(chips(12), false)).toBe(0);
  });
});

describe('règlement', () => {
  const cases: [HandOutcome, number][] = [
    ['BLACKJACK', 62],
    ['WIN', 50],
    ['PUSH', 25],
    ['LOSS', 0],
    ['SURRENDER', 12],
  ];

  it.each(cases)('%s sur une mise de 25 rend %i', (outcome, expected) => {
    expect(manager.returnedFor(outcome, chips(25))).toBe(expected);
  });
});

describe('validateBlackjackRules', () => {
  it('accepte les règles standard', () => {
    expect(validateBlackjackRules(STANDARD_BLACKJACK_RULES).ok).toBe(true);
  });

  it('refuse des règles incohérentes', () => {
    expectError(
      validateBlackjackRules({ ...STANDARD_BLACKJACK_RULES, deckCount: 0, maxBet: chips(5) }),
      'INVALID_RULES',
    );
  });
});
