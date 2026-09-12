export const PLINKO_ROWS = 16;
export const PLINKO_BUCKETS = PLINKO_ROWS + 1;

export const VOLATILITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type Volatility = (typeof VOLATILITIES)[number];

/** Rebond sur un clou : vers la gauche ou vers la droite. */
export type Direction = 'L' | 'R';

/** Table symétrique à partir de la moitié gauche, case centrale comprise. */
const mirror = (edgeToCenter: readonly number[]): readonly number[] => [...edgeToCenter, ...edgeToCenter.slice(0, -1).reverse()];

/**
 * Multiplicateurs en centièmes, du bord gauche au bord droit (17 cases).
 * Plus la volatilité est élevée, plus les bords paient et plus le centre punit : ×1000 aux extrémités en Élevée.
 */
export const MULTIPLIERS: Readonly<Record<Volatility, readonly number[]>> = {
  LOW: mirror([1_600, 900, 200, 140, 140, 110, 105, 100, 50]),
  MEDIUM: mirror([11_000, 4_000, 1_000, 500, 300, 140, 100, 50, 30]),
  HIGH: mirror([100_000, 12_000, 2_500, 900, 400, 200, 20, 20, 20]),
};

export function binomialCoefficient(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

/** Une bille qui fait k rebonds à droite sur 16 tombe dans la case k : loi binomiale B(16, ½). */
export function bucketProbability(bucket: number): number {
  return binomialCoefficient(PLINKO_ROWS, bucket) / 2 ** PLINKO_ROWS;
}

export function bucketOf(path: readonly Direction[]): number {
  return path.filter((direction) => direction === 'R').length;
}

/** Taux de retour théorique exact d'une volatilité. */
export function returnToPlayer(volatility: Volatility): number {
  return MULTIPLIERS[volatility].reduce((sum, multiplier, bucket) => sum + bucketProbability(bucket) * (multiplier / 100), 0);
}

/** 100000 → "1000", 20 → "0,2", 105 → "1,05". */
export function formatMultiplier(multiplier: number): string {
  return String(multiplier / 100).replace('.', ',');
}
