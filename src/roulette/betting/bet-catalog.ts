import { EngineError, err, invariant, ok, type Result } from '../../core/index.js';
import {
  INSIDE_BET_KINDS,
  type BetDefinition,
  type BetFamily,
  type BetId,
  type BetKind,
  type BetSelection,
  type InsideBetKind,
  type OutsideBetKind,
} from '../types/bet.js';
import {
  ALL_NUMBERS,
  RED_NUMBERS,
  columnOf,
  dozenOf,
  isRouletteNumber,
  rouletteNumber,
  type RouletteNumber,
  type Third,
} from '../wheel/pockets.js';
import { COVERAGE_SIZE, PAYOUT_TABLE } from './payout-table.js';

export const BET_KIND_LABELS: Readonly<Record<BetKind, string>> = {
  STRAIGHT: 'Plein',
  SPLIT: 'Cheval',
  STREET: 'Transversale',
  CORNER: 'Carré',
  SIX_LINE: 'Sixain',
  COLUMN: 'Colonne',
  DOZEN: 'Douzaine',
  RED: 'Rouge',
  BLACK: 'Noir',
  EVEN: 'Pair',
  ODD: 'Impair',
  LOW: 'Manque',
  HIGH: 'Passe',
};

const ROWS = 12;
const THIRDS: readonly Third[] = [1, 2, 3];
const INSIDE_KINDS: ReadonlySet<BetKind> = new Set(INSIDE_BET_KINDS);

const byAscending = (a: number, b: number): number => a - b;

/** Numéro situé ligne `row` (1 à 12, de 1-2-3 à 34-35-36) et colonne `column` (1 à 3) du tapis. */
const cell = (row: number, column: number): number => (row - 1) * 3 + column;
const rowNumbers = (row: number): number[] => THIRDS.map((column) => cell(row, column));

const familyOf = (kind: BetKind): BetFamily => (INSIDE_KINDS.has(kind) ? 'INSIDE' : 'OUTSIDE');

function insideBetId(kind: InsideBetKind, numbers: readonly number[]): BetId {
  return `${kind}:${[...numbers].sort(byAscending).join('-')}` as BetId;
}

function outsideBetId(kind: OutsideBetKind, index: Third | null): BetId {
  return (index === null ? kind : `${kind}:${index}`) as BetId;
}

function definition(kind: BetKind, id: BetId, label: string, numbers: readonly number[]): BetDefinition {
  return Object.freeze({
    id,
    kind,
    family: familyOf(kind),
    label,
    covers: Object.freeze([...numbers].sort(byAscending).map(rouletteNumber)),
    payout: PAYOUT_TABLE[kind],
  });
}

function describeSelection(selection: BetSelection): string {
  if ('numbers' in selection) return `${BET_KIND_LABELS[selection.kind]} ${selection.numbers.join('-')}`;
  if ('index' in selection) return `${BET_KIND_LABELS[selection.kind]} ${selection.index}`;
  return BET_KIND_LABELS[selection.kind];
}

/** Identifiant canonique d'une sélection : l'ordre des numéros saisis n'importe pas (1-2-4-5 = 5-4-2-1). */
function selectionId(selection: BetSelection): Result<BetId> {
  switch (selection.kind) {
    case 'COLUMN':
    case 'DOZEN':
      return THIRDS.includes(selection.index)
        ? ok(outsideBetId(selection.kind, selection.index))
        : err(new EngineError('INVALID_BET', `${describeSelection(selection)} : choisissez 1, 2 ou 3`));
    case 'RED':
    case 'BLACK':
    case 'EVEN':
    case 'ODD':
    case 'LOW':
    case 'HIGH':
      return ok(outsideBetId(selection.kind, null));
    default: {
      const { kind, numbers } = selection;
      const expected = COVERAGE_SIZE[kind];
      if (numbers.length !== expected || !numbers.every(isRouletteNumber) || new Set(numbers).size !== expected) {
        return err(
          new EngineError('INVALID_BET', `${BET_KIND_LABELS[kind]} : ${expected} numéro(s) distinct(s) entre 0 et 36 attendu(s)`, {
            numbers,
          }),
        );
      }
      return ok(insideBetId(kind, numbers));
    }
  }
}

/**
 * Graphe des mises : chaque position du tapis (nœud) est reliée aux numéros qu'elle couvre (arêtes).
 * Généré une seule fois à partir de la géométrie du tapis, il est l'unique source de vérité pour :
 *  - la validation : une mise interne n'existe que si ses numéros forment une position réelle (cheval 1-2 oui, 1-5 non) ;
 *  - le paiement : une mise gagne si et seulement si elle couvre le numéro sorti.
 */
export class BetCatalog {
  readonly all: readonly BetDefinition[];
  readonly #byId: ReadonlyMap<BetId, BetDefinition>;
  readonly #byNumber: ReadonlyMap<RouletteNumber, readonly BetDefinition[]>;

  constructor(definitions: readonly BetDefinition[]) {
    const byId = new Map<BetId, BetDefinition>();
    const byNumber = new Map<RouletteNumber, BetDefinition[]>(ALL_NUMBERS.map((n) => [n, []]));

    for (const bet of definitions) {
      invariant(!byId.has(bet.id), `Position de mise en double : ${bet.id}`);
      invariant(bet.covers.length === COVERAGE_SIZE[bet.kind], `${bet.id} doit couvrir ${COVERAGE_SIZE[bet.kind]} numéros`);
      invariant(bet.payout === PAYOUT_TABLE[bet.kind], `Rapport incohérent pour ${bet.id}`);
      // Règle du zéro : une mise externe ne couvre jamais le 0, elle est donc intégralement perdue quand il sort.
      invariant(bet.family === 'INSIDE' || bet.covers.every((n) => n !== 0), `La mise externe ${bet.id} ne peut pas couvrir le 0`);
      byId.set(bet.id, bet);
      for (const n of bet.covers) byNumber.get(n)?.push(bet);
    }

    this.all = definitions;
    this.#byId = byId;
    this.#byNumber = byNumber;
  }

  get(id: BetId): BetDefinition | undefined {
    return this.#byId.get(id);
  }

  /** Arêtes inverses du graphe : toutes les positions gagnantes quand `n` sort. */
  betsCovering(n: RouletteNumber): readonly BetDefinition[] {
    return this.#byNumber.get(n) ?? [];
  }

  /** Traduit la sélection du joueur en position du tapis, ou INVALID_BET si cette position n'existe pas. */
  resolve(selection: BetSelection): Result<BetDefinition> {
    const id = selectionId(selection);
    if (!id.ok) return id;
    const bet = this.#byId.get(id.value);
    if (bet === undefined) {
      return err(new EngineError('INVALID_BET', `${describeSelection(selection)} : cette position n'existe pas sur le tapis`));
    }
    return ok(bet);
  }
}

/** Génère les 157 positions du tapis européen à partir de sa géométrie (12 lignes × 3 colonnes, plus le 0). */
export function buildEuropeanBetCatalog(): BetCatalog {
  const bets: BetDefinition[] = [];

  const inside = (kind: InsideBetKind, numbers: readonly number[]): void => {
    const sorted = [...numbers].sort(byAscending);
    const shown = kind === 'SIX_LINE' ? `${sorted[0]}-${sorted[sorted.length - 1]}` : sorted.join('-');
    bets.push(definition(kind, insideBetId(kind, sorted), `${BET_KIND_LABELS[kind]} ${shown}`, sorted));
  };
  // Le 0 est exclu d'office : c'est la règle du zéro, contrôlée à nouveau par l'invariant du catalogue.
  const outside = (kind: OutsideBetKind, label: string, covers: (n: RouletteNumber) => boolean, index: Third | null = null): void => {
    bets.push(definition(kind, outsideBetId(kind, index), label, ALL_NUMBERS.filter((n) => n !== 0 && covers(n))));
  };

  for (const n of ALL_NUMBERS) inside('STRAIGHT', [n]);

  for (let row = 1; row <= ROWS; row += 1) {
    for (const column of THIRDS) {
      if (column < 3) inside('SPLIT', [cell(row, column), cell(row, column + 1)]);
      if (row < ROWS) inside('SPLIT', [cell(row, column), cell(row + 1, column)]);
      if (column < 3 && row < ROWS) {
        inside('CORNER', [cell(row, column), cell(row, column + 1), cell(row + 1, column), cell(row + 1, column + 1)]);
      }
    }
    inside('STREET', rowNumbers(row));
    if (row < ROWS) inside('SIX_LINE', [...rowNumbers(row), ...rowNumbers(row + 1)]);
  }

  // Positions à cheval sur le zéro : chevaux 0-1, 0-2, 0-3 ; transversales 0-1-2 et 0-2-3 ; carré 0-1-2-3.
  for (const n of [1, 2, 3]) inside('SPLIT', [0, n]);
  inside('STREET', [0, 1, 2]);
  inside('STREET', [0, 2, 3]);
  inside('CORNER', [0, 1, 2, 3]);

  for (const index of THIRDS) {
    outside('COLUMN', `Colonne ${index}`, (n) => columnOf(n) === index, index);
    outside('DOZEN', `Douzaine ${index} (${12 * index - 11}-${12 * index})`, (n) => dozenOf(n) === index, index);
  }
  outside('RED', 'Rouge', (n) => RED_NUMBERS.has(n));
  outside('BLACK', 'Noir', (n) => !RED_NUMBERS.has(n));
  outside('EVEN', 'Pair', (n) => n % 2 === 0);
  outside('ODD', 'Impair', (n) => n % 2 === 1);
  outside('LOW', 'Manque (1-18)', (n) => n <= 18);
  outside('HIGH', 'Passe (19-36)', (n) => n >= 19);

  return new BetCatalog(bets);
}

export const EUROPEAN_BET_CATALOG: BetCatalog = buildEuropeanBetCatalog();
