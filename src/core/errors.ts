/**
 * Deux familles d'erreurs, volontairement distinctes :
 *  - EngineError : action refusée par les règles (entrée utilisateur). Attendue, renvoyée dans un Result.
 *  - InvariantViolation : état impossible = bug du moteur. Levée comme exception, ne doit jamais arriver.
 */

export const ENGINE_ERROR_CODES = [
  'ILLEGAL_PHASE', // action interdite dans la phase courante (ex : miser pendant le tour des joueurs)
  'ILLEGAL_ACTION', // phase correcte mais règle violée (ex : Double Down sur 3 cartes)
  'NOT_YOUR_TURN',
  'UNKNOWN_PLAYER',
  'SEAT_TAKEN',
  'SEAT_OUT_OF_RANGE',
  'ALREADY_SEATED',
  'INVALID_AMOUNT',
  'INSUFFICIENT_FUNDS',
  'BET_OUT_OF_LIMITS',
  'INVALID_BET', // position absente du tapis (ex : cheval entre deux numéros non adjacents)
  'NOT_ENOUGH_PLAYERS',
  'SHOE_EXHAUSTED',
  'INVALID_CARD',
  'INVALID_RULES',
] as const;

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

export class EngineError extends Error {
  override readonly name = 'EngineError';
  readonly code: EngineErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: EngineErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export class InvariantViolation extends Error {
  override readonly name = 'InvariantViolation';
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new InvariantViolation(message);
  }
}
