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
  type Chips,
  type PlayerId,
  type RandomSource,
  type Result,
  type Transition,
} from '../../core/index.js';
import { FEVER_BALLS, FEVER_MULTIPLIER, JACKPOT_DIGIT, JACKPOT_ODDS, POCKETS, POCKET_TOTAL_WEIGHT, pocketForRoll } from '../pockets.js';
import { STANDARD_PACHINKO_RULES, validatePachinkoRules, type PachinkoRules } from '../rules.js';
import { PACHINKO_COMMAND_PHASES, type PachinkoCommand } from '../types/actions.js';
import type { PachinkoEngine, PachinkoLegalActions, PachinkoView } from '../types/contract.js';
import type { PachinkoEvent } from '../types/events.js';
import type { PachinkoBall, PachinkoState } from '../types/state.js';

type Step = Result<Transition<PachinkoState, PachinkoEvent>>;

/**
 * Game Controller du Pachinko. Contrat d'aléa : chaque bille commence par un tirage `rng.nextInt(POCKET_TOTAL_WEIGHT)`
 * qui fixe sa poche ; une poche Bonus hors Fever tire ensuite la machine à sous (1 chance sur JACKPOT_ODDS de 777).
 */
export class PachinkoController implements PachinkoEngine {
  readonly #rng: RandomSource;

  constructor(rng: RandomSource) {
    this.#rng = rng;
  }

  createSession(playerId: PlayerId, bankroll: number, rules: PachinkoRules = STANDARD_PACHINKO_RULES): Result<PachinkoState> {
    const validated = validatePachinkoRules(rules);
    if (!validated.ok) return validated;
    if (!isChips(bankroll)) return err(new EngineError('INVALID_AMOUNT', `Solde invalide : ${bankroll}`));
    return ok({ phase: 'READY', rules, player: { id: playerId, bankroll }, feverBallsLeft: 0, feverStake: chips(0), ballsLaunched: 0, lastBalls: [] });
  }

  apply(state: PachinkoState, command: PachinkoCommand): Step {
    const allowedPhases: readonly string[] = PACHINKO_COMMAND_PHASES[command.type];
    if (!allowedPhases.includes(state.phase)) {
      return err(new EngineError('ILLEGAL_PHASE', `${command.type} impossible pendant la phase ${state.phase}`));
    }
    if (command.playerId !== state.player.id) {
      return err(new EngineError('UNKNOWN_PLAYER', "Ce joueur n'est pas titulaire de la session"));
    }
    switch (command.type) {
      case 'LAUNCH_BALL':
        return this.#launch(state, command.stake);
      case 'FEVER_BALL':
        return this.#feverBall(state);
    }
  }

  legalActions(state: PachinkoState, playerId: PlayerId): PachinkoLegalActions {
    if (playerId !== state.player.id) return { actions: [], stakeRange: null };
    if (state.phase === 'FEVER') return { actions: ['FEVER_BALL'], stakeRange: null };
    const max = Math.min(state.rules.maxStake, state.player.bankroll);
    return max >= state.rules.minStake ? { actions: ['LAUNCH_BALL'], stakeRange: { min: state.rules.minStake, max: chips(max) } } : { actions: [], stakeRange: null };
  }

  project(state: PachinkoState, viewer: PlayerId | null): PachinkoView {
    return {
      phase: state.phase,
      viewer,
      bankroll: viewer === state.player.id ? state.player.bankroll : null,
      feverBallsLeft: state.feverBallsLeft,
      lastBalls: state.lastBalls,
      legalActions: viewer === null ? { actions: [], stakeRange: null } : this.legalActions(state, viewer),
    };
  }

  /** La trajectoire d'une bille n'existe qu'une fois lancée : rien à masquer. */
  projectEvent(event: PachinkoEvent, _viewer: PlayerId | null): PachinkoEvent {
    return event;
  }

  #launch(state: PachinkoState, stake: number): Step {
    const { minStake, maxStake } = state.rules;
    if (!isChips(stake) || stake === 0) return err(new EngineError('INVALID_AMOUNT', `Mise invalide : ${stake}`));
    if (stake < minStake || stake > maxStake) {
      return err(new EngineError('BET_OUT_OF_LIMITS', `La mise doit être comprise entre ${minStake} et ${maxStake} jetons`));
    }
    if (stake > state.player.bankroll) {
      return err(new EngineError('INSUFFICIENT_FUNDS', `Mise de ${stake} supérieure au solde`, { bankroll: state.player.bankroll }));
    }
    const ball = this.#resolve(state.ballsLaunched + 1, stake, false);
    const bankroll = addChips(subtractChips(state.player.bankroll, stake), ball.payout);
    const events: PachinkoEvent[] = [{ type: 'BALL_LANDED', ball, bankroll }];
    if (ball.feverTriggered) events.push({ type: 'FEVER_STARTED', balls: FEVER_BALLS, stake });
    return ok({
      state: {
        ...state,
        phase: ball.feverTriggered ? 'FEVER' : 'READY',
        player: { ...state.player, bankroll },
        feverBallsLeft: ball.feverTriggered ? FEVER_BALLS : 0,
        feverStake: ball.feverTriggered ? stake : chips(0),
        ballsLaunched: ball.id,
        lastBalls: [ball, ...state.lastBalls].slice(0, state.rules.historySize),
      },
      events,
    });
  }

  #feverBall(state: PachinkoState): Step {
    invariant(state.feverBallsLeft > 0, 'Fever Mode sans bille');
    const ball = this.#resolve(state.ballsLaunched + 1, state.feverStake, true);
    const bankroll = addChips(state.player.bankroll, ball.payout);
    const feverBallsLeft = state.feverBallsLeft - 1;
    const events: PachinkoEvent[] = [{ type: 'BALL_LANDED', ball, bankroll }];
    if (feverBallsLeft === 0) events.push({ type: 'FEVER_ENDED' });
    return ok({
      state: {
        ...state,
        phase: feverBallsLeft === 0 ? 'READY' : 'FEVER',
        player: { ...state.player, bankroll },
        feverBallsLeft,
        feverStake: feverBallsLeft === 0 ? chips(0) : state.feverStake,
        ballsLaunched: ball.id,
        lastBalls: [ball, ...state.lastBalls].slice(0, state.rules.historySize),
      },
      events,
    });
  }

  #resolve(id: number, stake: Chips, free: boolean): PachinkoBall {
    const index = pocketForRoll(this.#rng.nextInt(POCKET_TOTAL_WEIGHT));
    const pocket = POCKETS[index];
    invariant(pocket !== undefined, `Poche inexistante : ${index}`);
    const multiplier = pocket.multiplier * (free ? FEVER_MULTIPLIER : 1);

    let slot: PachinkoBall['slot'] = null;
    let feverTriggered = false;
    if (!free && pocket.metal === 'BONUS') {
      feverTriggered = this.#rng.nextInt(JACKPOT_ODDS) === 0;
      if (feverTriggered) {
        slot = [JACKPOT_DIGIT, JACKPOT_DIGIT, JACKPOT_DIGIT];
      } else {
        const first = this.#rng.nextInt(10);
        const second = this.#rng.nextInt(10);
        // Le troisième chiffre ne complète jamais un brelan : seul le tirage du jackpot affiche trois chiffres identiques.
        const third = first === second ? (first + 1 + this.#rng.nextInt(9)) % 10 : this.#rng.nextInt(10);
        slot = [first, second, third];
      }
    }
    return { id, stake, free, pocket: index, multiplier, payout: applyRatioFloor(stake, { numerator: multiplier, denominator: 100 }), slot, feverTriggered };
  }
}
