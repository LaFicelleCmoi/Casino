import { InvariantViolation, chips, invariant, shuffle, sumChips, type RandomSource } from '../../core/index.js';
import type { CellGroup, CrosswordBoard, ScratchCell, ScratchZone, TicketEvaluation, ZoneResult } from '../types/ticket.js';

export function pick<T>(rng: RandomSource, items: readonly T[]): T {
  invariant(items.length > 0, 'Tirage dans une liste vide');
  return items[rng.nextInt(items.length)] as T;
}

export function chance(rng: RandomSource, numerator: number, denominator: number): boolean {
  return rng.nextInt(denominator) < numerator;
}

export function randomInt(rng: RandomSource, min: number, max: number): number {
  return min + rng.nextInt(max - min + 1);
}

export function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** `count` éléments distincts, dans un ordre aléatoire. */
export function sample<T>(rng: RandomSource, items: readonly T[], count: number): T[] {
  invariant(items.length >= count, `Échantillon de ${count} impossible dans ${items.length} éléments`);
  return shuffle(items, rng).slice(0, count);
}

/** `count` valeurs dont aucune n'apparaît plus de `maxCopies` fois (pour empêcher un brelan involontaire). */
export function sampleWithCap<T>(rng: RandomSource, values: readonly T[], maxCopies: number, count: number): T[] {
  return sample(
    rng,
    values.flatMap((value) => Array.from({ length: maxCopies }, () => value)),
    count,
  );
}

/** 1000000 → "1 000 000". */
export function formatAmount(amount: number): string {
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export interface CellData {
  readonly symbol: string;
  readonly label: string;
  readonly amount?: number;
  readonly value?: number;
}

export const amountCell = (amount: number): CellData => ({ symbol: 'AMOUNT', label: formatAmount(amount), amount });

export function group(
  zoneId: string,
  id: string,
  label: string,
  columns: number,
  cells: readonly CellData[],
  printed = false,
): CellGroup {
  return {
    id,
    label,
    columns,
    printed,
    cells: cells.map(
      (data, index): ScratchCell => ({
        id: `${zoneId}.${id}.${index}`,
        symbol: data.symbol,
        label: data.label,
        amount: data.amount === undefined ? null : chips(data.amount),
        value: data.value ?? null,
      }),
    ),
  };
}

export function zone(
  id: string,
  title: string,
  rule: string,
  groups: readonly CellGroup[],
  board: CrosswordBoard | null = null,
): ScratchZone {
  return { id, title, rule, groups, board };
}

export function zoneById(zones: readonly ScratchZone[], id: string): ScratchZone {
  const found = zones.find((candidate) => candidate.id === id);
  invariant(found !== undefined, `Zone ${id} absente du ticket`);
  return found;
}

export function groupById(zoneOfGroup: ScratchZone, id: string): CellGroup {
  const found = zoneOfGroup.groups.find((candidate) => candidate.id === id);
  invariant(found !== undefined, `Groupe ${id} absent de la zone ${zoneOfGroup.id}`);
  return found;
}

export function firstCell(zoneOfGroup: ScratchZone, groupId: string): ScratchCell {
  const cell = groupById(zoneOfGroup, groupId).cells[0];
  invariant(cell !== undefined, `Groupe ${groupId} vide`);
  return cell;
}

export function cellsOf(zoneOfCells: ScratchZone): ScratchCell[] {
  return zoneOfCells.groups.flatMap((cellGroup) => cellGroup.cells);
}

export function zoneResult(zoneId: string, amount: number, detail: string, marks: readonly string[] = []): ZoneResult {
  return { zoneId, won: amount > 0, amount: chips(amount), detail, marks };
}

export function ticketEvaluation(zones: readonly ZoneResult[], multiplier = 1): TicketEvaluation {
  return { zones, multiplier, total: chips(sumChips(zones.map((result) => result.amount)) * multiplier) };
}

/** Tirage pondéré : [valeur, poids]. */
export function weightedPick<T>(rng: RandomSource, entries: readonly (readonly [T, number])[]): T {
  let roll = rng.nextInt(entries.reduce((sum, [, weight]) => sum + weight, 0));
  for (const [value, weight] of entries) {
    if (roll < weight) return value;
    roll -= weight;
  }
  throw new InvariantViolation('Tirage pondéré impossible');
}

/** Montants de leurre : les petites sommes sont plus fréquentes que les grosses. */
export function decoyAmount(rng: RandomSource, amounts: readonly number[]): number {
  return weightedPick(
    rng,
    amounts.map((amount, index) => [amount, (amounts.length - index) ** 2] as const),
  );
}

/** Emplacement où un gain peut être imprimé : `capacity` gains au plus, parmi `amounts`. */
export interface PrizeSlot {
  readonly id: string;
  readonly capacity: number;
  readonly amounts: readonly number[];
}

export interface PrizePart {
  readonly slot: string;
  readonly amount: number;
}

const decompositionCache = new WeakMap<readonly PrizeSlot[], Map<string, readonly (readonly PrizePart[])[]>>();

/** Toutes les façons d'obtenir `total` en cumulant au plus `maxParts` gains répartis dans les emplacements. */
export function decompositions(total: number, slots: readonly PrizeSlot[], maxParts: number): readonly (readonly PrizePart[])[] {
  let byTotal = decompositionCache.get(slots);
  if (byTotal === undefined) {
    byTotal = new Map();
    decompositionCache.set(slots, byTotal);
  }
  const key = `${total}/${maxParts}`;
  const cached = byTotal.get(key);
  if (cached !== undefined) return cached;

  const results: PrizePart[][] = [];
  const visit = (slotIndex: number, remaining: number, parts: PrizePart[], fromAmount: number, usedInSlot: number): void => {
    if (remaining === 0) {
      if (parts.length > 0) results.push(parts);
      return;
    }
    const slot = slots[slotIndex];
    if (slot === undefined || parts.length >= maxParts) return;
    if (usedInSlot < slot.capacity) {
      slot.amounts.forEach((amount, index) => {
        if (index >= fromAmount && amount <= remaining) {
          visit(slotIndex, remaining - amount, [...parts, { slot: slot.id, amount }], index, usedInSlot + 1);
        }
      });
    }
    visit(slotIndex + 1, remaining, parts, 0, 0);
  };
  visit(0, total, [], 0, 0);
  byTotal.set(key, results);
  return results;
}

/** Répartition d'un lot : le plus souvent en un minimum de gains, parfois en plusieurs gains cumulés. */
export function chooseDecomposition(rng: RandomSource, total: number, slots: readonly PrizeSlot[], maxParts: number): readonly PrizePart[] {
  if (total === 0) return [];
  const options = decompositions(total, slots, maxParts);
  invariant(options.length > 0, `Lot de ${total} impossible à imprimer`);
  const fewest = Math.min(...options.map((option) => option.length));
  return pick(rng, chance(rng, 3, 4) ? options.filter((option) => option.length === fewest) : options);
}

export function partsFor(parts: readonly PrizePart[], slot: string): number[] {
  return parts.filter((part) => part.slot === slot).map((part) => part.amount);
}

/** Les deux premiers éléments d'une liste qui en compte au moins deux. */
export function firstTwo<T>(items: readonly T[]): [T, T] {
  invariant(items.length >= 2, 'Au moins deux éléments attendus');
  return [items[0] as T, items[1] as T];
}

/** Regroupe des cases par symbole. */
export function bySymbol(cells: readonly ScratchCell[]): Map<string, ScratchCell[]> {
  const groups = new Map<string, ScratchCell[]>();
  for (const cell of cells) groups.set(cell.symbol, [...(groups.get(cell.symbol) ?? []), cell]);
  return groups;
}
