export type Metal = 'BRONZE' | 'ARGENT' | 'OR' | 'PLATINE' | 'BONUS';

export interface Pocket {
  readonly metal: Metal;
  readonly label: string;
  /** En centièmes : 1000 = ×10. */
  readonly multiplier: number;
  /** Poids relatif : probabilité d'y tomber = poids / poids total. */
  readonly weight: number;
}

const pocket = (metal: Metal, label: string, multiplier: number, weight: number): Pocket => ({ metal, label, multiplier, weight });

/**
 * Les 9 poches du bas du plateau, de gauche à droite : métaux symétriques, Platine au centre encadré de deux poches
 * Bonus (les « tulipes ») qui déclenchent la machine à sous.
 */
export const POCKETS: readonly Pocket[] = [
  pocket('BRONZE', 'Bronze', 20, 18),
  pocket('ARGENT', 'Argent', 50, 14),
  pocket('OR', 'Or', 150, 8),
  pocket('BONUS', 'Bonus', 100, 6),
  pocket('PLATINE', 'Platine', 1_000, 1),
  pocket('BONUS', 'Bonus', 100, 6),
  pocket('OR', 'Or', 150, 8),
  pocket('ARGENT', 'Argent', 50, 14),
  pocket('BRONZE', 'Bronze', 20, 18),
];

export const POCKET_TOTAL_WEIGHT = POCKETS.reduce((sum, entry) => sum + entry.weight, 0);
/** Une poche Bonus déclenche le Fever Mode avec une chance sur JACKPOT_ODDS (777 sur la machine à sous). */
export const JACKPOT_ODDS = 8;
export const JACKPOT_DIGIT = 7;
/** Billes gratuites du Fever Mode, dont tous les multiplicateurs sont doublés. */
export const FEVER_BALLS = 10;
export const FEVER_MULTIPLIER = 2;
/** Poche au plus gros multiplicateur. */
export const TOP_POCKET = POCKETS.reduce((best, entry, index) => (entry.multiplier > (POCKETS[best]?.multiplier ?? 0) ? index : best), 0);

/** Poche correspondant au tirage `roll` ∈ [0, POCKET_TOTAL_WEIGHT). */
export function pocketForRoll(roll: number): number {
  let remaining = roll;
  for (let index = 0; index < POCKETS.length; index += 1) {
    remaining -= POCKETS[index]?.weight ?? 0;
    if (remaining < 0) return index;
  }
  return POCKETS.length - 1;
}

/** Premier tirage qui envoie une bille dans la poche `index`. */
export function rollForPocket(index: number): number {
  return POCKETS.slice(0, index).reduce((sum, entry) => sum + entry.weight, 0);
}

/** Retour théorique d'une bille payante, Fever Mode compris : les billes du Fever valent deux billes ordinaires sans machine à sous. */
export function returnToPlayer(): number {
  const base = POCKETS.reduce((sum, entry) => sum + (entry.weight / POCKET_TOTAL_WEIGHT) * (entry.multiplier / 100), 0);
  const bonusChance = POCKETS.filter((entry) => entry.metal === 'BONUS').reduce((sum, entry) => sum + entry.weight, 0) / POCKET_TOTAL_WEIGHT;
  return base + bonusChance * (1 / JACKPOT_ODDS) * FEVER_BALLS * FEVER_MULTIPLIER * base;
}

/** 150 → "1,5", 20 → "0,2". */
export function formatPocketMultiplier(multiplier: number): string {
  return String(multiplier / 100).replace('.', ',');
}
