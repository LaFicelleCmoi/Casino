import { expect } from 'vitest';
import { parseCard, type Card, type EngineErrorCode, type Result } from '../src/core/index.js';

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

export function expectError(result: Result<unknown>, code: EngineErrorCode): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

/** cards('As Kd 7c') → cartes correspondantes. */
export function cards(notation: string): Card[] {
  return notation
    .trim()
    .split(/\s+/)
    .filter((code) => code !== '')
    .map((code) => unwrap(parseCard(code)));
}
