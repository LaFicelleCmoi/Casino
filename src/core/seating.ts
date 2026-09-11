import type { SeatIndex } from './player.js';

/** Tous les sièges dans le sens horaire, en commençant par celui qui suit `from` (`from` arrive en dernier). */
export function clockwiseFrom(from: SeatIndex, seatCount: number): SeatIndex[] {
  return Array.from({ length: seatCount }, (_, offset) => (from + 1 + offset) % seatCount);
}
