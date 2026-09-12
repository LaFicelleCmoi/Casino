import { invariant, type RandomSource } from '../../core/index.js';
import { EUROPEAN_WHEEL_ORDER, type RouletteNumber } from './pockets.js';

export interface WheelSpin {
  /** Index de la case dans EUROPEAN_WHEEL_ORDER : permet à une UI d'animer la bille jusqu'à la bonne case. */
  readonly pocketIndex: number;
  readonly number: RouletteNumber;
}

/**
 * RNG de la roue : une case tirée uniformément parmi les 37 du cylindre (probabilité 1/37 chacune).
 * L'aléa vient de la RandomSource injectée — CSPRNG sans biais de modulo en production, seed en test —
 * ce qui rend chaque tirage testable et chaque partie rejouable.
 */
export class RouletteWheel {
  readonly #rng: RandomSource;

  constructor(rng: RandomSource) {
    this.#rng = rng;
  }

  spin(): WheelSpin {
    const pocketIndex = this.#rng.nextInt(EUROPEAN_WHEEL_ORDER.length);
    const number = EUROPEAN_WHEEL_ORDER[pocketIndex];
    invariant(number !== undefined, `Case de roue inexistante : ${pocketIndex}`);
    return { pocketIndex, number };
  }
}
