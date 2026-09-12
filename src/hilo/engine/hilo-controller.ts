import {
  EngineError,
  addChips,
  applyRatioFloor,
  chips,
  err,
  invariant,
  isChips,
  ok,
  subtractChips,
  type PlayerId,
  type RandomSource,
  type Result,
  type Transition,
} from '../../core/index.js';
import { drawHiloCard, isGuessAllowed, isWinningGuess, stepMultiplier, winChance, type HiloDirection } from '../cards.js';
import { STANDARD_HILO_RULES, validateHiloRules, type HiloRules } from '../rules.js';
import { HILO_COMMAND_PHASES, type HiloCommand, type HiloCommandType } from '../types/actions.js';
import type { HiloChoice, HiloEngine, HiloLegalActions, HiloView } from '../types/contract.js';
import type { HiloEvent } from '../types/events.js';
import type { HiloIdlePhase, HiloPlayingPhase, HiloRoundResult, HiloState } from '../types/state.js';

type Step = Result<Transition<HiloState, HiloEvent>>;

const NO_ACTIONS: HiloLegalActions = { actions: [], stakeRange: null };
const DIRECTIONS: readonly HiloDirection[] = ['HIGHER', 'LOWER'];

function done(state: HiloState, events: readonly HiloEvent[] = []): Step {
  return ok({ state, events });
}

/**
 * Game Controller du Hi-Lo. La carte suivante est tirée d'avance ; chaque pronostic gagné multiplie la série par
 * (1 − marge) / chance, un joker fait passer la carte, et le joueur encaisse quand il le souhaite.
 */
export class HiloController implements HiloEngine {
  readonly #rng: RandomSource;

  constructor(rng: RandomSource) {
    this.#rng = rng;
  }

  createSession(playerId: PlayerId, bankroll: number, rules: HiloRules = STANDARD_HILO_RULES): Result<HiloIdlePhase> {
    const validated = validateHiloRules(rules);
    if (!validated.ok) return validated;
    if (!isChips(bankroll)) return err(new EngineError('INVALID_AMOUNT', `Solde invalide : ${bankroll}`));
    return ok({ phase: 'IDLE', rules, player: { id: playerId, bankroll }, roundsPlayed: 0, lastRound: null });
  }

  apply(state: HiloState, command: HiloCommand): Step {
    const allowedPhases: readonly string[] = HILO_COMMAND_PHASES[command.type];
    if (!allowedPhases.includes(state.phase)) {
      return err(new EngineError('ILLEGAL_PHASE', `${command.type} impossible pendant la phase ${state.phase}`));
    }
    if (command.playerId !== state.player.id) {
      return err(new EngineError('UNKNOWN_PLAYER', "Ce joueur n'est pas titulaire de la session"));
    }
    switch (command.type) {
      case 'START_ROUND':
        invariant(state.phase === 'IDLE', 'Partie déjà en cours');
        return this.#start(state, command.stake);
      case 'GUESS':
        invariant(state.phase === 'PLAYING', 'Aucune partie en cours');
        return this.#guess(state, command.direction);
      case 'JOKER':
        invariant(state.phase === 'PLAYING', 'Aucune partie en cours');
        return this.#joker(state);
      case 'CASH_OUT':
        invariant(state.phase === 'PLAYING', 'Aucune partie en cours');
        if (state.round.streak === 0) return err(new EngineError('ILLEGAL_ACTION', 'Gagnez au moins un pronostic avant d’encaisser'));
        return this.#finish(state, 'CASHED_OUT', state.round.current, []);
    }
  }

  legalActions(state: HiloState, playerId: PlayerId): HiloLegalActions {
    if (playerId !== state.player.id) return NO_ACTIONS;
    if (state.phase === 'PLAYING') {
      const actions: HiloCommandType[] = ['GUESS'];
      if (state.round.jokersLeft > 0) actions.push('JOKER');
      if (state.round.streak > 0) actions.push('CASH_OUT');
      return { actions, stakeRange: null };
    }
    const max = Math.min(state.rules.maxStake, state.player.bankroll);
    return max >= state.rules.minStake ? { actions: ['START_ROUND'], stakeRange: { min: state.rules.minStake, max: chips(max) } } : NO_ACTIONS;
  }

  project(state: HiloState, viewer: PlayerId | null): HiloView {
    const round = state.phase === 'PLAYING' ? state.round : null;
    const choice = (direction: HiloDirection): HiloChoice =>
      round === null
        ? { allowed: false, chance: 0, multiplier: 0 }
        : {
            allowed: isGuessAllowed(round.current.rank, direction),
            chance: winChance(round.current.rank, direction),
            multiplier: stepMultiplier(round.current.rank, direction, state.rules.houseEdge),
          };
    return {
      phase: state.phase,
      viewer,
      bankroll: viewer === state.player.id ? state.player.bankroll : null,
      round:
        round === null
          ? null
          : {
              stake: round.stake,
              current: round.current,
              multiplier: round.multiplier,
              streak: round.streak,
              jokersLeft: round.jokersLeft,
              steps: round.steps,
              higher: choice('HIGHER'),
              lower: choice('LOWER'),
              cashOutValue: applyRatioFloor(round.stake, { numerator: round.multiplier, denominator: 100 }),
            },
      lastRound: state.phase === 'IDLE' ? state.lastRound : null,
      legalActions: viewer === null ? NO_ACTIONS : this.legalActions(state, viewer),
    };
  }

  /** Les événements ne montrent une carte qu'une fois retournée. */
  projectEvent(event: HiloEvent, _viewer: PlayerId | null): HiloEvent {
    return event;
  }

  #start(state: HiloIdlePhase, stake: number): Step {
    const { minStake, maxStake, jokersPerRound } = state.rules;
    if (!isChips(stake) || stake === 0) return err(new EngineError('INVALID_AMOUNT', `Mise invalide : ${stake}`));
    if (stake < minStake || stake > maxStake) {
      return err(new EngineError('BET_OUT_OF_LIMITS', `La mise doit être comprise entre ${minStake} et ${maxStake} jetons`));
    }
    if (stake > state.player.bankroll) {
      return err(new EngineError('INSUFFICIENT_FUNDS', `Mise de ${stake} supérieure au solde`, { bankroll: state.player.bankroll }));
    }
    const current = drawHiloCard(this.#rng);
    const next = drawHiloCard(this.#rng);
    const bankroll = subtractChips(state.player.bankroll, stake);
    const playing: HiloPlayingPhase = {
      phase: 'PLAYING',
      rules: state.rules,
      player: { ...state.player, bankroll },
      roundsPlayed: state.roundsPlayed,
      round: { stake, current, next, multiplier: 100, streak: 0, jokersLeft: jokersPerRound, steps: [] },
    };
    return done(playing, [{ type: 'ROUND_STARTED', card: current, stake, bankroll }]);
  }

  #guess(state: HiloPlayingPhase, direction: HiloDirection): Step {
    const { round, rules } = state;
    if (!DIRECTIONS.includes(direction)) return err(new EngineError('ILLEGAL_ACTION', `Pronostic inconnu : ${String(direction)}`));
    if (!isGuessAllowed(round.current.rank, direction)) {
      return err(new EngineError('ILLEGAL_ACTION', 'Ce pronostic est gagné d’avance : choisissez l’autre'));
    }
    const won = isWinningGuess(round.current, round.next, direction);
    if (!won) {
      const steps = [...round.steps, { from: round.current, to: round.next, action: direction, won: false, multiplier: 0 }];
      return this.#finish({ ...state, round: { ...round, steps } }, 'LOST', round.next, [
        { type: 'CARD_TURNED', card: round.next, action: direction, won: false, multiplier: 0 },
      ]);
    }
    const multiplier = Math.min(rules.maxMultiplier, Math.floor((round.multiplier * stepMultiplier(round.current.rank, direction, rules.houseEdge)) / 100));
    const next: HiloPlayingPhase = {
      ...state,
      round: {
        ...round,
        current: round.next,
        next: drawHiloCard(this.#rng),
        multiplier,
        streak: round.streak + 1,
        steps: [...round.steps, { from: round.current, to: round.next, action: direction, won: true, multiplier }],
      },
    };
    const events: HiloEvent[] = [{ type: 'CARD_TURNED', card: round.next, action: direction, won: true, multiplier }];
    return multiplier >= rules.maxMultiplier ? this.#finish(next, 'CASHED_OUT', next.round.current, events) : done(next, events);
  }

  #joker(state: HiloPlayingPhase): Step {
    const { round } = state;
    if (round.jokersLeft === 0) return err(new EngineError('ILLEGAL_ACTION', 'Plus aucun joker disponible'));
    const next: HiloPlayingPhase = {
      ...state,
      round: {
        ...round,
        current: round.next,
        next: drawHiloCard(this.#rng),
        jokersLeft: round.jokersLeft - 1,
        steps: [...round.steps, { from: round.current, to: round.next, action: 'JOKER', won: true, multiplier: round.multiplier }],
      },
    };
    return done(next, [{ type: 'CARD_TURNED', card: round.next, action: 'JOKER', won: true, multiplier: round.multiplier }]);
  }

  #finish(state: HiloPlayingPhase, outcome: 'LOST' | 'CASHED_OUT', lastCard: HiloPlayingPhase['round']['current'], events: HiloEvent[]): Step {
    const { round } = state;
    const payout = outcome === 'LOST' ? chips(0) : applyRatioFloor(round.stake, { numerator: round.multiplier, denominator: 100 });
    const bankroll = addChips(state.player.bankroll, payout);
    const lastRound: HiloRoundResult = {
      stake: round.stake,
      steps: round.steps,
      outcome,
      multiplier: outcome === 'LOST' ? 0 : round.multiplier,
      streak: round.streak,
      payout,
      net: payout - round.stake,
      lastCard,
    };
    events.push(outcome === 'LOST' ? { type: 'ROUND_LOST', card: lastCard } : { type: 'CASHED_OUT', multiplier: round.multiplier, payout, bankroll });
    const idle: HiloIdlePhase = { phase: 'IDLE', rules: state.rules, player: { ...state.player, bankroll }, roundsPlayed: state.roundsPlayed + 1, lastRound };
    return done(idle, events);
  }
}
