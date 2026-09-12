import {
  EngineError,
  addChips,
  chips,
  err,
  invariant,
  isChips,
  ok,
  subtractChips,
  sumChips,
  type PlayerId,
  type RandomSource,
  type Result,
  type Transition,
} from '../../core/index.js';
import { createRaceCard, runRace } from '../model/field.js';
import { betOdds, isWinningBet, payoutOf, validateSelection } from '../model/odds.js';
import { STANDARD_RACING_RULES, validateRacingRules, type RacingRules } from '../rules.js';
import { RACING_COMMAND_PHASES, type RacingCommand, type RacingCommandType } from '../types/actions.js';
import type { RacingEngine, RacingLegalActions, RacingView } from '../types/contract.js';
import type { RacingEvent } from '../types/events.js';
import type { PlacedRaceBet, RaceBetSelection, RaceBetSettlement } from '../types/race.js';
import type { RacingBettingPhase, RacingFinishedPhase, RacingPlayer, RacingState } from '../types/state.js';

type Step = Result<Transition<RacingState, RacingEvent>>;

const NO_ACTIONS: RacingLegalActions = { actions: [], stakeRange: null };

function done(state: RacingState, events: readonly RacingEvent[] = []): Step {
  return ok({ state, events });
}

const stakedOn = (bets: readonly PlacedRaceBet[]): number => sumChips(bets.map((bet) => bet.stake));

/**
 * Game Controller des courses hippiques virtuelles. Chaque course est programmée avec son arrivée déjà tirée ;
 * les cotes, calculées exactement sur le modèle de Plackett-Luce, sont figées au moment du pari.
 */
export class RacingController implements RacingEngine {
  readonly #rng: RandomSource;

  constructor(rng: RandomSource) {
    this.#rng = rng;
  }

  createSession(playerId: PlayerId, bankroll: number, rules: RacingRules = STANDARD_RACING_RULES): Result<RacingBettingPhase> {
    const validated = validateRacingRules(rules);
    if (!validated.ok) return validated;
    if (!isChips(bankroll)) return err(new EngineError('INVALID_AMOUNT', `Solde invalide : ${bankroll}`));
    return ok(this.#schedule(rules, { id: playerId, bankroll }, 1));
  }

  apply(state: RacingState, command: RacingCommand): Step {
    const allowedPhases: readonly string[] = RACING_COMMAND_PHASES[command.type];
    if (!allowedPhases.includes(state.phase)) {
      return err(new EngineError('ILLEGAL_PHASE', `${command.type} impossible pendant la phase ${state.phase}`));
    }
    if ('playerId' in command && command.playerId !== state.player.id) {
      return err(new EngineError('UNKNOWN_PLAYER', "Ce parieur n'est pas titulaire de la session"));
    }
    try {
      switch (command.type) {
        case 'PLACE_BET':
          invariant(state.phase === 'BETTING', 'Pari hors des prises de paris');
          return this.#placeBet(state, command.bet, command.stake);
        case 'CANCEL_BET': {
          invariant(state.phase === 'BETTING', 'Annulation hors des prises de paris');
          const bet = state.bets.find((candidate) => candidate.id === command.betId);
          if (bet === undefined) return err(new EngineError('ILLEGAL_ACTION', `Pari introuvable : ${command.betId}`));
          const bankroll = addChips(state.player.bankroll, bet.stake);
          const next: RacingBettingPhase = { ...state, player: { ...state.player, bankroll }, bets: state.bets.filter((candidate) => candidate !== bet) };
          return done(next, [{ type: 'BET_CANCELLED', betId: bet.id, refunded: bet.stake, bankroll }]);
        }
        case 'CLEAR_BETS': {
          invariant(state.phase === 'BETTING', 'Annulation hors des prises de paris');
          const refunded = chips(stakedOn(state.bets));
          const bankroll = addChips(state.player.bankroll, refunded);
          return done({ ...state, player: { ...state.player, bankroll }, bets: [] }, [{ type: 'BETS_CLEARED', refunded, bankroll }]);
        }
        case 'START_RACE':
          invariant(state.phase === 'BETTING', 'Départ hors des prises de paris');
          return this.#race(state);
        case 'NEXT_RACE': {
          const next = this.#schedule(state.rules, state.player, state.card.raceNumber + 1);
          return done(next, [{ type: 'RACE_CARD_PUBLISHED', card: next.card }]);
        }
      }
    } catch (error) {
      if (error instanceof EngineError) return err(error);
      throw error;
    }
  }

  legalActions(state: RacingState, playerId: PlayerId): RacingLegalActions {
    if (playerId !== state.player.id || state.phase !== 'BETTING') return NO_ACTIONS;
    const { minStake, maxStake, maxBetsPerRace } = state.rules;
    const max = Math.min(maxStake, state.player.bankroll);
    const canBet = max >= minStake && state.bets.length < maxBetsPerRace;
    const actions: RacingCommandType[] = [];
    if (canBet) actions.push('PLACE_BET');
    if (state.bets.length > 0) actions.push('CANCEL_BET', 'CLEAR_BETS');
    return { actions, stakeRange: canBet ? { min: minStake, max: chips(max) } : null };
  }

  project(state: RacingState, viewer: PlayerId | null): RacingView {
    const finished = state.phase === 'FINISHED' ? state : null;
    return {
      phase: state.phase,
      viewer,
      rules: state.rules,
      card: state.card,
      bankroll: viewer === state.player.id ? state.player.bankroll : null,
      bets: state.phase === 'BETTING' ? state.bets : (finished?.settlements.map((settlement) => settlement.bet) ?? []),
      result: finished?.result ?? null,
      settlements: finished?.settlements ?? [],
      legalActions: viewer === null ? NO_ACTIONS : this.legalActions(state, viewer),
    };
  }

  /** Aucun événement ne dévoile l'arrivée avant RACE_FINISHED. */
  projectEvent(event: RacingEvent, _viewer: PlayerId | null): RacingEvent {
    return event;
  }

  #schedule(rules: RacingRules, player: RacingPlayer, raceNumber: number): RacingBettingPhase {
    const card = createRaceCard(this.#rng, rules, raceNumber);
    return { phase: 'BETTING', rules, player, card, betCounter: 0, bets: [], sealedResult: runRace(this.#rng, card) };
  }

  #placeBet(state: RacingBettingPhase, selection: RaceBetSelection, stake: number): Step {
    const validated = validateSelection(state.card, selection);
    if (!validated.ok) return validated;
    const { minStake, maxStake, maxBetsPerRace } = state.rules;
    if (!isChips(stake) || stake === 0) return err(new EngineError('INVALID_AMOUNT', `Mise invalide : ${stake}`));
    if (stake < minStake || stake > maxStake) {
      return err(new EngineError('BET_OUT_OF_LIMITS', `La mise doit être comprise entre ${minStake} et ${maxStake} jetons`));
    }
    if (stake > state.player.bankroll) {
      return err(new EngineError('INSUFFICIENT_FUNDS', `Mise de ${stake} supérieure au solde`, { bankroll: state.player.bankroll }));
    }
    if (state.bets.length >= maxBetsPerRace) {
      return err(new EngineError('ILLEGAL_ACTION', `Pas plus de ${maxBetsPerRace} paris par course`));
    }

    const betCounter = state.betCounter + 1;
    const bet: PlacedRaceBet = {
      id: `C${state.card.raceNumber}-P${betCounter}`,
      kind: selection.kind,
      horses: [...selection.horses],
      stake,
      odds: betOdds(state.card, state.rules, selection),
    };
    const bankroll = subtractChips(state.player.bankroll, stake);
    const next: RacingBettingPhase = { ...state, player: { ...state.player, bankroll }, betCounter, bets: [...state.bets, bet] };
    return done(next, [{ type: 'BET_PLACED', bet, bankroll }]);
  }

  #race(state: RacingBettingPhase): Step {
    const result = state.sealedResult;
    const settlements = state.bets.map((bet): RaceBetSettlement => {
      const won = isWinningBet(result, bet.kind, bet.horses);
      const payout = won ? payoutOf(bet.stake, bet.odds) : chips(0);
      return { bet, won, payout, net: payout - bet.stake };
    });
    const paid = chips(sumChips(settlements.map((settlement) => settlement.payout)));
    const bankroll = addChips(state.player.bankroll, paid);
    const finished: RacingFinishedPhase = {
      phase: 'FINISHED',
      rules: state.rules,
      player: { ...state.player, bankroll },
      card: state.card,
      betCounter: state.betCounter,
      result,
      settlements,
      net: paid - stakedOn(state.bets),
    };
    return done(finished, [
      { type: 'RACE_STARTED', raceNumber: state.card.raceNumber },
      { type: 'RACE_FINISHED', raceNumber: state.card.raceNumber, result },
      ...settlements.map((settlement): RacingEvent => ({ type: 'BET_SETTLED', settlement })),
      { type: 'WINNINGS_PAID', amount: paid, bankroll },
    ]);
  }
}
