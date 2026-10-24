import type { ChipRange, Chips, GameEngine, GameTypes, PlayerCommand, PlayerId } from '../core/index.js';
import type { CoinflipRules, CoinSide } from './rules.js';

export type CoinflipCommand =
  /** Nouveau lancer : la mise est débitée, le gain crédité aussitôt si le pronostic est bon. */
  | (PlayerCommand<'FLIP'> & { readonly stake: Chips; readonly call: CoinSide })
  /** Quitte ou double : tout le gain du lancer précédent, s'il est gagnant, est remis en jeu. */
  | (PlayerCommand<'RIDE'> & { readonly call: CoinSide });

export type CoinflipCommandType = CoinflipCommand['type'];

export interface CoinflipResult {
  readonly round: number;
  readonly call: CoinSide;
  readonly side: CoinSide;
  readonly won: boolean;
  readonly stake: Chips;
  readonly payout: Chips;
  readonly net: number;
  /** Rang dans une série de quitte ou double : 1 pour un lancer simple. */
  readonly chain: number;
}

export interface CoinflipStats {
  readonly flips: number;
  readonly wins: number;
  readonly pile: number;
  readonly face: number;
  readonly wagered: number;
  readonly biggestWin: number;
  /** Plus longue série de quitte ou double gagnée. */
  readonly bestChain: number;
}

export interface CoinflipPlayer {
  readonly id: PlayerId;
  readonly bankroll: Chips;
}

/** Une seule phase : chaque lancer est réglé d'un coup. Le prochain côté est tiré d'avance et jamais montré. */
export interface CoinflipState {
  readonly rules: CoinflipRules;
  readonly player: CoinflipPlayer;
  readonly upcoming: CoinSide;
  readonly lastFlip: CoinflipResult | null;
  /** Derniers côtés sortis, du plus récent au plus ancien. */
  readonly history: readonly CoinSide[];
  readonly stats: CoinflipStats;
}

export type CoinflipEvent = { readonly type: 'COIN_FLIPPED'; readonly result: CoinflipResult; readonly bankroll: Chips };

export interface CoinflipLegalActions {
  readonly actions: readonly CoinflipCommandType[];
  readonly stakeRange: ChipRange | null;
  /** Mise d'un quitte ou double, s'il est possible. */
  readonly rideStake: Chips | null;
}

export interface CoinflipView {
  readonly viewer: PlayerId | null;
  readonly bankroll: Chips | null;
  readonly lastFlip: CoinflipResult | null;
  readonly history: readonly CoinSide[];
  readonly stats: CoinflipStats;
  /** Série en cours du même côté (ex. 3 Face d'affilée). */
  readonly run: { readonly side: CoinSide; readonly length: number } | null;
  readonly legalActions: CoinflipLegalActions;
}

export interface CoinflipGame extends GameTypes {
  readonly state: CoinflipState;
  readonly command: CoinflipCommand;
  readonly event: CoinflipEvent;
  readonly view: CoinflipView;
  readonly viewEvent: CoinflipEvent;
  readonly legalActions: CoinflipLegalActions;
}

export type CoinflipEngine = GameEngine<CoinflipGame>;
