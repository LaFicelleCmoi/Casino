import {
  EngineError,
  addChips,
  applyRatioFloor,
  chips,
  err,
  isChips,
  ok,
  subtractChips,
  type Chips,
  type PlayerId,
  type RandomSource,
  type Result,
  type Transition,
} from '../core/index.js';
import { COINFLIP_HISTORY_SIZE, COIN_SIDES, STANDARD_COINFLIP_RULES, isCoinSide, validateCoinflipRules, type CoinSide, type CoinflipRules } from './rules.js';
import type {
  CoinflipCommand,
  CoinflipEngine,
  CoinflipEvent,
  CoinflipLegalActions,
  CoinflipResult,
  CoinflipState,
  CoinflipStats,
  CoinflipView,
} from './types.js';

type Step = Result<Transition<CoinflipState, CoinflipEvent>>;

const NO_ACTIONS: CoinflipLegalActions = { actions: [], stakeRange: null, rideStake: null };

export const EMPTY_COINFLIP_STATS: CoinflipStats = Object.freeze({
  flips: 0,
  wins: 0,
  pile: 0,
  face: 0,
  wagered: 0,
  biggestWin: 0,
  bestChain: 0,
});

/**
 * Game Controller du Pile ou Face. Le côté du prochain lancer est tiré dès le lancer précédent et gardé dans l'état,
 * hors de toute vue : la partie reste rejouable avec une seed, et rien ne peut être deviné depuis l'interface.
 */
export class CoinflipController implements CoinflipEngine {
  readonly #rng: RandomSource;

  constructor(rng: RandomSource) {
    this.#rng = rng;
  }

  createSession(playerId: PlayerId, bankroll: number, rules: CoinflipRules = STANDARD_COINFLIP_RULES): Result<CoinflipState> {
    const validated = validateCoinflipRules(rules);
    if (!validated.ok) return validated;
    if (!isChips(bankroll)) return err(new EngineError('INVALID_AMOUNT', `Solde invalide : ${bankroll}`));
    return ok({
      rules,
      player: { id: playerId, bankroll },
      upcoming: this.#toss(),
      lastFlip: null,
      history: [],
      stats: EMPTY_COINFLIP_STATS,
    });
  }

  apply(state: CoinflipState, command: CoinflipCommand): Step {
    if (command.playerId !== state.player.id) {
      return err(new EngineError('UNKNOWN_PLAYER', "Ce joueur n'est pas titulaire de la session"));
    }
    if (!isCoinSide(command.call)) return err(new EngineError('ILLEGAL_ACTION', 'Choisissez Pile ou Face'));
    if (command.type === 'FLIP') {
      const { minStake, maxStake } = state.rules;
      if (!isChips(command.stake) || command.stake === 0) return err(new EngineError('INVALID_AMOUNT', `Mise invalide : ${command.stake}`));
      if (command.stake < minStake || command.stake > maxStake) {
        return err(new EngineError('BET_OUT_OF_LIMITS', `La mise doit être comprise entre ${minStake} et ${maxStake} jetons`));
      }
      return this.#flip(state, command.stake, command.call, 1);
    }
    const rideStake = this.#rideStake(state);
    if (rideStake === null) {
      return err(new EngineError('ILLEGAL_ACTION', 'Le quitte ou double suit un lancer gagnant, dans la limite de la série'));
    }
    return this.#flip(state, rideStake, command.call, (state.lastFlip?.chain ?? 0) + 1);
  }

  legalActions(state: CoinflipState, playerId: PlayerId): CoinflipLegalActions {
    if (playerId !== state.player.id) return NO_ACTIONS;
    const max = Math.min(state.rules.maxStake, state.player.bankroll);
    const rideStake = this.#rideStake(state);
    const actions: CoinflipCommand['type'][] = [];
    if (max >= state.rules.minStake) actions.push('FLIP');
    if (rideStake !== null) actions.push('RIDE');
    return { actions, stakeRange: max >= state.rules.minStake ? { min: state.rules.minStake, max: chips(max) } : null, rideStake };
  }

  project(state: CoinflipState, viewer: PlayerId | null): CoinflipView {
    const [latest] = state.history;
    let length = 0;
    while (latest !== undefined && state.history[length] === latest) length += 1;
    return {
      viewer,
      bankroll: viewer === state.player.id ? state.player.bankroll : null,
      lastFlip: state.lastFlip,
      history: state.history,
      stats: state.stats,
      run: latest === undefined ? null : { side: latest, length },
      legalActions: viewer === null ? NO_ACTIONS : this.legalActions(state, viewer),
    };
  }

  /** Le résultat n'est publié qu'une fois le lancer joué : rien à masquer. */
  projectEvent(event: CoinflipEvent, _viewer: PlayerId | null): CoinflipEvent {
    return event;
  }

  /** Mise d'un quitte ou double : le gain entier du dernier lancer, s'il est gagnant et que la série n'est pas finie. */
  #rideStake(state: CoinflipState): Chips | null {
    const last = state.lastFlip;
    if (last === null || !last.won || last.chain >= state.rules.maxChain || last.payout > state.player.bankroll) return null;
    return last.payout;
  }

  #flip(state: CoinflipState, stake: Chips, call: CoinSide, chain: number): Step {
    if (stake > state.player.bankroll) {
      return err(new EngineError('INSUFFICIENT_FUNDS', `Mise de ${stake} supérieure au solde`, { bankroll: state.player.bankroll }));
    }
    const side = state.upcoming;
    const won = side === call;
    const payout = won ? applyRatioFloor(stake, state.rules.payout) : chips(0);
    const bankroll = addChips(subtractChips(state.player.bankroll, stake), payout);
    const { stats } = state;
    const result: CoinflipResult = { round: stats.flips + 1, call, side, won, stake, payout, net: payout - stake, chain };
    const next: CoinflipState = {
      ...state,
      player: { ...state.player, bankroll },
      upcoming: this.#toss(),
      lastFlip: result,
      history: [side, ...state.history].slice(0, COINFLIP_HISTORY_SIZE),
      stats: {
        flips: stats.flips + 1,
        wins: stats.wins + (won ? 1 : 0),
        pile: stats.pile + (side === 'PILE' ? 1 : 0),
        face: stats.face + (side === 'FACE' ? 1 : 0),
        wagered: stats.wagered + stake,
        biggestWin: Math.max(stats.biggestWin, result.net),
        bestChain: won ? Math.max(stats.bestChain, chain) : stats.bestChain,
      },
    };
    return ok({ state: next, events: [{ type: 'COIN_FLIPPED', result, bankroll }] });
  }

  #toss(): CoinSide {
    return COIN_SIDES[this.#rng.nextInt(2)] ?? 'PILE';
  }
}
