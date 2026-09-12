import { MINES_TILES } from './rules.js';

/** Probabilité de découvrir `revealed` diamants d'affilée quand `mines` bombes sont cachées. */
export function survivalChance(mines: number, revealed: number): number {
  let chance = 1;
  for (let i = 0; i < revealed; i += 1) chance *= (MINES_TILES - mines - i) / (MINES_TILES - i);
  return chance;
}

/** Multiplicateur en centièmes après `revealed` diamants : (1 − marge) / chance de survie, arrondi à l'inférieur. */
export function minesMultiplier(mines: number, revealed: number, houseEdge: number): number {
  if (revealed === 0) return 100;
  return Math.floor(((1 - houseEdge) / survivalChance(mines, revealed)) * 100 + 1e-9);
}

/** Chance que la prochaine case explorée soit un diamant. */
export function nextDiamondChance(mines: number, revealed: number): number {
  const hidden = MINES_TILES - revealed;
  return (hidden - mines) / hidden;
}

/** 245 → "2,45". */
export function formatMultiplier(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}
