import { EngineError } from './errors.js';

declare const playerIdBrand: unique symbol;

export type PlayerId = string & { readonly [playerIdBrand]: 'PlayerId' };

export function playerId(value: string): PlayerId {
  if (value.trim() === '') {
    throw new EngineError('UNKNOWN_PLAYER', 'Un identifiant joueur ne peut pas être vide');
  }
  return value as PlayerId;
}

/** Position physique à la table, de 0 à rules.seatCount - 1. */
export type SeatIndex = number;

export interface PlayerProfile {
  readonly id: PlayerId;
  readonly displayName: string;
}
