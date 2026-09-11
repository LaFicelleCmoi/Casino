import { ZERO_CHIPS, chips, playerId, type SeatIndex } from '../../src/core/index.js';
import type { BettingRound, PokerSeat } from '../../src/holdem/index.js';

export function pokerSeat(seatIndex: SeatIndex, overrides: Partial<PokerSeat> = {}): PokerSeat {
  return {
    seatIndex,
    player: { id: playerId(`p${seatIndex}`), displayName: `Joueur ${seatIndex}` },
    stack: chips(1_000),
    status: 'IN_HAND',
    holeCards: null,
    streetBet: ZERO_CHIPS,
    totalCommitted: ZERO_CHIPS,
    hasActed: false,
    lastAction: null,
    ...overrides,
  };
}

export function bettingRound(currentBet: number, minRaise = 10, toAct: SeatIndex = 0): BettingRound {
  return { toAct, currentBet: chips(currentBet), minRaise: chips(minRaise), lastAggressor: null };
}
