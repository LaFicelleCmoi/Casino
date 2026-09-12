import type { Chips, PlayerId } from '../../core/index.js';
import type { Direction, Volatility } from '../board.js';
import type { PlinkoRules } from '../rules.js';

export interface PlinkoDrop {
  readonly id: number;
  readonly stake: Chips;
  readonly volatility: Volatility;
  /** Un rebond par rangée, de haut en bas. */
  readonly path: readonly Direction[];
  /** Case d'arrivée, de 0 (bord gauche) à 16 (bord droit). */
  readonly bucket: number;
  /** En centièmes : 100000 = ×1000. */
  readonly multiplier: number;
  /** Mise × multiplicateur, arrondi à l'inférieur. */
  readonly payout: Chips;
}

/**
 * Le Plinko n'a qu'une phase : chaque bille est réglée à l'instant où elle est lâchée, ce qui autorise
 * autant de chutes simultanées que l'interface veut en animer.
 */
export interface PlinkoState {
  readonly phase: 'READY';
  readonly rules: PlinkoRules;
  readonly player: { readonly id: PlayerId; readonly bankroll: Chips };
  readonly volatility: Volatility;
  readonly dropCount: number;
  /** Dernières billes, la plus récente en tête. */
  readonly lastDrops: readonly PlinkoDrop[];
}

export type PlinkoPhase = PlinkoState['phase'];
