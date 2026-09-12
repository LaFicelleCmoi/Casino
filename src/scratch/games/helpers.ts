import { chips, invariant, shuffle, sumChips, type RandomSource } from '../../core/index.js';
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

export function group(zoneId: string, id: string, label: string, columns: number, cells: readonly CellData[]): CellGroup {
  return {
    id,
    label,
    columns,
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

/** Regroupe des cases par symbole. */
export function bySymbol(cells: readonly ScratchCell[]): Map<string, ScratchCell[]> {
  const groups = new Map<string, ScratchCell[]>();
  for (const cell of cells) groups.set(cell.symbol, [...(groups.get(cell.symbol) ?? []), cell]);
  return groups;
}
