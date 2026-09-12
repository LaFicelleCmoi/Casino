import {
  EngineError,
  addChips,
  applyRatioFloor,
  chips,
  err,
  isChips,
  ok,
  subtractChips,
  type PlayerId,
  type RandomSource,
  type Result,
  type Transition,
} from '../../core/index.js';
import { MULTIPLIERS, PLINKO_ROWS, VOLATILITIES, bucketOf, type Direction } from '../board.js';
import { STANDARD_PLINKO_RULES, validatePlinkoRules, type PlinkoRules } from '../rules.js';
import { PLINKO_COMMAND_PHASES, type PlinkoCommand } from '../types/actions.js';
import type { PlinkoEngine, PlinkoLegalActions, PlinkoView } from '../types/contract.js';
import type { PlinkoEvent } from '../types/events.js';
import type { PlinkoDrop, PlinkoState } from '../types/state.js';

type Step = Result<Transition<PlinkoState, PlinkoEvent>>;

/**
 * Game Controller du Plinko. Contrat d'aléa : chaque bille consomme exactement PLINKO_ROWS tirages
 * `rng.nextInt(2)`, un par rangée, dans l'ordre (0 = gauche, 1 = droite).
 */
export class PlinkoController implements PlinkoEngine {
  readonly #rng: RandomSource;

  constructor(rng: RandomSource) {
    this.#rng = rng;
  }

  createSession(playerId: PlayerId, bankroll: number, rules: PlinkoRules = STANDARD_PLINKO_RULES): Result<PlinkoState> {
    const validated = validatePlinkoRules(rules);
    if (!validated.ok) return validated;
    if (!isChips(bankroll)) return err(new EngineError('INVALID_AMOUNT', `Solde invalide : ${bankroll}`));
    return ok({ phase: 'READY', rules, player: { id: playerId, bankroll }, volatility: 'MEDIUM', dropCount: 0, lastDrops: [] });
  }

  apply(state: PlinkoState, command: PlinkoCommand): Step {
    const allowedPhases: readonly string[] = PLINKO_COMMAND_PHASES[command.type];
    if (!allowedPhases.includes(state.phase)) {
      return err(new EngineError('ILLEGAL_PHASE', `${command.type} impossible pendant la phase ${state.phase}`));
    }
    if (command.playerId !== state.player.id) {
      return err(new EngineError('UNKNOWN_PLAYER', "Ce joueur n'est pas titulaire de la session"));
    }
    switch (command.type) {
      case 'SET_VOLATILITY': {
        if (!(VOLATILITIES as readonly string[]).includes(command.volatility)) {
          return err(new EngineError('ILLEGAL_ACTION', `Volatilité inconnue : ${String(command.volatility)}`));
        }
        return ok({ state: { ...state, volatility: command.volatility }, events: [{ type: 'VOLATILITY_CHANGED', volatility: command.volatility }] });
      }
      case 'DROP_BALL':
        return this.#drop(state, command.stake);
    }
  }

  legalActions(state: PlinkoState, playerId: PlayerId): PlinkoLegalActions {
    if (playerId !== state.player.id) return { actions: [], stakeRange: null };
    const max = Math.min(state.rules.maxStake, state.player.bankroll);
    const canDrop = max >= state.rules.minStake;
    return {
      actions: canDrop ? ['SET_VOLATILITY', 'DROP_BALL'] : ['SET_VOLATILITY'],
      stakeRange: canDrop ? { min: state.rules.minStake, max: chips(max) } : null,
    };
  }

  project(state: PlinkoState, viewer: PlayerId | null): PlinkoView {
    return {
      phase: state.phase,
      viewer,
      bankroll: viewer === state.player.id ? state.player.bankroll : null,
      volatility: state.volatility,
      multipliers: MULTIPLIERS[state.volatility],
      lastDrops: state.lastDrops,
      legalActions: viewer === null ? { actions: [], stakeRange: null } : this.legalActions(state, viewer),
    };
  }

  /** Le trajet d'une bille n'existe qu'une fois lâchée : rien à masquer. */
  projectEvent(event: PlinkoEvent, _viewer: PlayerId | null): PlinkoEvent {
    return event;
  }

  #drop(state: PlinkoState, stake: number): Step {
    const { minStake, maxStake, historySize } = state.rules;
    if (!isChips(stake) || stake === 0) return err(new EngineError('INVALID_AMOUNT', `Mise invalide : ${stake}`));
    if (stake < minStake || stake > maxStake) {
      return err(new EngineError('BET_OUT_OF_LIMITS', `La mise doit être comprise entre ${minStake} et ${maxStake} jetons`));
    }
    if (stake > state.player.bankroll) {
      return err(new EngineError('INSUFFICIENT_FUNDS', `Mise de ${stake} supérieure au solde`, { bankroll: state.player.bankroll }));
    }

    const path = Array.from({ length: PLINKO_ROWS }, (): Direction => (this.#rng.nextInt(2) === 0 ? 'L' : 'R'));
    const bucket = bucketOf(path);
    const multiplier = MULTIPLIERS[state.volatility][bucket] ?? 0;
    const payout = applyRatioFloor(stake, { numerator: multiplier, denominator: 100 });
    const drop: PlinkoDrop = { id: state.dropCount + 1, stake, volatility: state.volatility, path, bucket, multiplier, payout };
    const bankroll = addChips(subtractChips(state.player.bankroll, stake), payout);

    const next: PlinkoState = {
      ...state,
      player: { ...state.player, bankroll },
      dropCount: drop.id,
      lastDrops: [drop, ...state.lastDrops].slice(0, historySize),
    };
    return ok({ state: next, events: [{ type: 'BALL_DROPPED', drop, bankroll }] });
  }
}

