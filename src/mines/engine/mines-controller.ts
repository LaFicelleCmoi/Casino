import {
  EngineError,
  addChips,
  applyRatioFloor,
  chips,
  err,
  invariant,
  isChips,
  ok,
  shuffle,
  subtractChips,
  type PlayerId,
  type RandomSource,
  type Result,
  type Transition,
} from '../../core/index.js';
import { minesMultiplier, nextDiamondChance } from '../multiplier.js';
import { MAX_MINES, MIN_MINES, MINES_TILES, STANDARD_MINES_RULES, validateMinesRules, type MinesRules } from '../rules.js';
import { MINES_COMMAND_PHASES, type MinesCommand } from '../types/actions.js';
import type { MinesEngine, MinesLegalActions, MinesView } from '../types/contract.js';
import type { MinesEvent } from '../types/events.js';
import type { MinesIdlePhase, MinesPlayingPhase, MinesRoundResult, MinesState } from '../types/state.js';

type Step = Result<Transition<MinesState, MinesEvent>>;

const NO_ACTIONS: MinesLegalActions = { actions: [], stakeRange: null };

function done(state: MinesState, events: readonly MinesEvent[] = []): Step {
  return ok({ state, events });
}

/**
 * Game Controller du jeu des Mines. Les bombes sont placées au départ ; chaque diamant fait grimper le multiplicateur
 * à (1 − marge) / chance d'avoir survécu jusque-là, et le joueur peut encaisser à tout moment.
 */
export class MinesController implements MinesEngine {
  readonly #rng: RandomSource;

  constructor(rng: RandomSource) {
    this.#rng = rng;
  }

  createSession(playerId: PlayerId, bankroll: number, rules: MinesRules = STANDARD_MINES_RULES): Result<MinesIdlePhase> {
    const validated = validateMinesRules(rules);
    if (!validated.ok) return validated;
    if (!isChips(bankroll)) return err(new EngineError('INVALID_AMOUNT', `Solde invalide : ${bankroll}`));
    return ok({ phase: 'IDLE', rules, player: { id: playerId, bankroll }, roundsPlayed: 0, lastRound: null });
  }

  apply(state: MinesState, command: MinesCommand): Step {
    const allowedPhases: readonly string[] = MINES_COMMAND_PHASES[command.type];
    if (!allowedPhases.includes(state.phase)) {
      return err(new EngineError('ILLEGAL_PHASE', `${command.type} impossible pendant la phase ${state.phase}`));
    }
    if (command.playerId !== state.player.id) {
      return err(new EngineError('UNKNOWN_PLAYER', "Ce joueur n'est pas titulaire de la session"));
    }
    switch (command.type) {
      case 'START_ROUND':
        invariant(state.phase === 'IDLE', 'Partie déjà en cours');
        return this.#start(state, command.stake, command.mines);
      case 'REVEAL':
        invariant(state.phase === 'PLAYING', 'Aucune partie en cours');
        return this.#reveal(state, command.tile);
      case 'CASH_OUT':
        invariant(state.phase === 'PLAYING', 'Aucune partie en cours');
        if (state.round.revealed.length === 0) {
          return err(new EngineError('ILLEGAL_ACTION', 'Découvrez au moins un diamant avant d’encaisser'));
        }
        return this.#finish(state, null, []);
    }
  }

  legalActions(state: MinesState, playerId: PlayerId): MinesLegalActions {
    if (playerId !== state.player.id) return NO_ACTIONS;
    if (state.phase === 'PLAYING') {
      return { actions: state.round.revealed.length > 0 ? ['REVEAL', 'CASH_OUT'] : ['REVEAL'], stakeRange: null };
    }
    const max = Math.min(state.rules.maxStake, state.player.bankroll);
    return max >= state.rules.minStake
      ? { actions: ['START_ROUND'], stakeRange: { min: state.rules.minStake, max: chips(max) } }
      : NO_ACTIONS;
  }

  project(state: MinesState, viewer: PlayerId | null): MinesView {
    const playing = state.phase === 'PLAYING' ? state : null;
    const round = playing?.round ?? null;
    return {
      phase: state.phase,
      viewer,
      bankroll: viewer === state.player.id ? state.player.bankroll : null,
      round:
        round === null
          ? null
          : {
              stake: round.stake,
              mineCount: round.mineCount,
              revealed: round.revealed,
              multiplier: round.multiplier,
              nextMultiplier: minesMultiplier(round.mineCount, round.revealed.length + 1, state.rules.houseEdge),
              nextDiamondChance: nextDiamondChance(round.mineCount, round.revealed.length),
              cashOutValue: applyRatioFloor(round.stake, { numerator: round.multiplier, denominator: 100 }),
            },
      lastRound: state.phase === 'IDLE' ? state.lastRound : null,
      legalActions: viewer === null ? NO_ACTIONS : this.legalActions(state, viewer),
    };
  }

  /** Les bombes ne figurent que dans MINE_HIT, émis quand la partie est déjà perdue. */
  projectEvent(event: MinesEvent, _viewer: PlayerId | null): MinesEvent {
    return event;
  }

  #start(state: MinesIdlePhase, stake: number, mineCount: number): Step {
    if (!Number.isInteger(mineCount) || mineCount < MIN_MINES || mineCount > MAX_MINES) {
      return err(new EngineError('ILLEGAL_ACTION', `Choisissez entre ${MIN_MINES} et ${MAX_MINES} bombes`));
    }
    const { minStake, maxStake } = state.rules;
    if (!isChips(stake) || stake === 0) return err(new EngineError('INVALID_AMOUNT', `Mise invalide : ${stake}`));
    if (stake < minStake || stake > maxStake) {
      return err(new EngineError('BET_OUT_OF_LIMITS', `La mise doit être comprise entre ${minStake} et ${maxStake} jetons`));
    }
    if (stake > state.player.bankroll) {
      return err(new EngineError('INSUFFICIENT_FUNDS', `Mise de ${stake} supérieure au solde`, { bankroll: state.player.bankroll }));
    }

    const tiles = Array.from({ length: MINES_TILES }, (_, tile) => tile);
    const mines = shuffle(tiles, this.#rng).slice(0, mineCount).sort((a, b) => a - b);
    const bankroll = subtractChips(state.player.bankroll, stake);
    const playing: MinesPlayingPhase = {
      phase: 'PLAYING',
      rules: state.rules,
      player: { ...state.player, bankroll },
      roundsPlayed: state.roundsPlayed,
      round: { stake, mineCount, mines, revealed: [], multiplier: 100 },
    };
    return done(playing, [{ type: 'ROUND_STARTED', stake, mineCount, bankroll }]);
  }

  #reveal(state: MinesPlayingPhase, tile: number): Step {
    const { round } = state;
    if (!Number.isInteger(tile) || tile < 0 || tile >= MINES_TILES) return err(new EngineError('ILLEGAL_ACTION', `Case inexistante : ${tile}`));
    if (round.revealed.includes(tile)) return err(new EngineError('ILLEGAL_ACTION', 'Cette case est déjà explorée'));
    if (round.mines.includes(tile)) return this.#finish(state, tile, []);

    const revealed = [...round.revealed, tile];
    const multiplier = minesMultiplier(round.mineCount, revealed.length, state.rules.houseEdge);
    const next: MinesPlayingPhase = { ...state, round: { ...round, revealed, multiplier } };
    const events: MinesEvent[] = [{ type: 'DIAMOND_FOUND', tile, multiplier }];
    // Plus aucun diamant à trouver : la partie est encaissée d'office.
    return revealed.length === MINES_TILES - round.mineCount ? this.#finish(next, null, events) : done(next, events);
  }

  #finish(state: MinesPlayingPhase, hitMine: number | null, events: MinesEvent[]): Step {
    const { round } = state;
    const busted = hitMine !== null;
    const payout = busted ? chips(0) : applyRatioFloor(round.stake, { numerator: round.multiplier, denominator: 100 });
    const bankroll = addChips(state.player.bankroll, payout);
    const lastRound: MinesRoundResult = {
      stake: round.stake,
      mineCount: round.mineCount,
      mines: round.mines,
      revealed: round.revealed,
      outcome: busted ? 'BUSTED' : 'CASHED_OUT',
      hitMine,
      multiplier: busted ? 0 : round.multiplier,
      payout,
      net: payout - round.stake,
    };
    events.push(
      busted
        ? { type: 'MINE_HIT', tile: hitMine, mines: round.mines }
        : { type: 'CASHED_OUT', multiplier: round.multiplier, payout, bankroll },
    );
    const idle: MinesIdlePhase = {
      phase: 'IDLE',
      rules: state.rules,
      player: { ...state.player, bankroll },
      roundsPlayed: state.roundsPlayed + 1,
      lastRound,
    };
    return done(idle, events);
  }
}
