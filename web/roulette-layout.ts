import {
  ALL_NUMBERS,
  EUROPEAN_WHEEL_ORDER,
  colorOf,
  columnOf,
  dozenOf,
  type BetCatalog,
  type BetDefinition,
  type BetKind,
  type BetSelection,
  type PocketColor,
} from '../src/roulette/index.js';

/** Angle occupé par une case du cylindre, en degrés. */
export const SEGMENT = 360 / EUROPEAN_WHEEL_ORDER.length;

const POCKET_FILLS: Readonly<Record<PocketColor, string>> = { GREEN: '#1f7a4c', RED: '#b3261e', BLACK: '#161616' };
const SPOT_KINDS: ReadonlySet<BetKind> = new Set<BetKind>(['SPLIT', 'STREET', 'CORNER', 'SIX_LINE']);

/** Traduit une position du graphe en sélection pour PLACE_BET (pour rejouer une mise mémorisée par son id). */
export function selectionOf(bet: BetDefinition): BetSelection {
  const [first] = bet.covers;
  switch (bet.kind) {
    case 'COLUMN':
    case 'DOZEN': {
      const index = first === undefined ? null : bet.kind === 'COLUMN' ? columnOf(first) : dozenOf(first);
      if (index === null) throw new Error(`Position externe sans numéro : ${bet.id}`);
      return { kind: bet.kind, index };
    }
    case 'RED':
    case 'BLACK':
    case 'EVEN':
    case 'ODD':
    case 'LOW':
    case 'HIGH':
      return { kind: bet.kind };
    default:
      return { kind: bet.kind, numbers: bet.covers } as unknown as BetSelection;
  }
}

/** Centre de la case d'un numéro sur le tapis horizontal, en unités de case : x ∈ [0, 12], y ∈ [0, 3] (le 3 en haut). */
function cellCenter(n: number): { readonly x: number; readonly y: number } {
  return { x: Math.ceil(n / 3) - 0.5, y: 2.5 - ((n - 1) % 3) };
}

const average = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Emplacement d'un jeton à cheval (cheval, transversale, carré, sixain), en unités de case sur la grille des numéros. */
export function hotspotPosition(bet: BetDefinition): { readonly x: number; readonly y: number } {
  const centers = bet.covers.filter((n) => n !== 0).map(cellCenter);
  if (centers.length !== bet.covers.length) {
    // Positions touchant le zéro : sur le bord gauche de la grille ; le carré 0-1-2-3 se joue au coin inférieur.
    return { x: 0, y: bet.kind === 'CORNER' ? 3 : average(centers.map((c) => c.y)) };
  }
  const x = average(centers.map((c) => c.x));
  // Transversales et sixains se jouent sur la ligne extérieure, en bas du tableau des numéros.
  return { x, y: bet.kind === 'STREET' || bet.kind === 'SIX_LINE' ? 3 : average(centers.map((c) => c.y)) };
}

const EVEN_MONEY: readonly (readonly [BetSelection, string])[] = [
  [{ kind: 'LOW' }, '1 à 18'],
  [{ kind: 'EVEN' }, 'Pair'],
  [{ kind: 'RED' }, '<span class="rl-diamond rl-red"></span>'],
  [{ kind: 'BLACK' }, '<span class="rl-diamond rl-black"></span>'],
  [{ kind: 'ODD' }, 'Impair'],
  [{ kind: 'HIGH' }, '19 à 36'],
];

/** Tapis horizontal : le 0 à gauche, 12 colonnes de numéros (3 en haut, 1 en bas), « 2 à 1 », douzaines, chances simples. */
export function layoutHtml(catalog: BetCatalog): string {
  const cell = (selection: BetSelection, classes: string, area: string, content: string): string => {
    const resolved = catalog.resolve(selection);
    if (!resolved.ok) throw resolved.error;
    const { id, label } = resolved.value;
    return `<button type="button" class="rl-cell ${classes}" data-bet="${id}" style="${area}" aria-label="${label}"><span>${content}</span><i class="rl-chip"></i></button>`;
  };

  const parts = [cell({ kind: 'STRAIGHT', numbers: [0] }, 'rl-zero rl-green', 'grid-column:1;grid-row:1 / span 3', '0')];
  for (const n of ALL_NUMBERS) {
    if (n === 0) continue;
    const area = `grid-column:${Math.ceil(n / 3) + 1};grid-row:${3 - ((n - 1) % 3)}`;
    parts.push(cell({ kind: 'STRAIGHT', numbers: [n] }, `rl-${colorOf(n).toLowerCase()}`, area, String(n)));
  }
  for (const index of [1, 2, 3] as const) {
    parts.push(cell({ kind: 'COLUMN', index }, 'rl-outside', `grid-column:14;grid-row:${4 - index}`, '2 à 1'));
    parts.push(cell({ kind: 'DOZEN', index }, 'rl-outside', `grid-column:${4 * index - 2} / span 4;grid-row:4`, `${12 * index - 11} à ${12 * index}`));
  }
  EVEN_MONEY.forEach(([selection, content], i) => {
    parts.push(cell(selection, 'rl-outside', `grid-column:${2 * i + 2} / span 2;grid-row:5`, content));
  });

  const spots = catalog.all
    .filter((bet) => SPOT_KINDS.has(bet.kind))
    .map((bet) => {
      const { x, y } = hotspotPosition(bet);
      const style = `left:${((x / 12) * 100).toFixed(3)}%;top:${((y / 3) * 100).toFixed(3)}%`;
      return `<button type="button" class="rl-spot" data-bet="${bet.id}" style="${style}" aria-label="${bet.label}" title="${bet.label}"><i class="rl-chip"></i></button>`;
    });
  parts.push(`<div class="rl-spots" style="grid-column:2 / span 12;grid-row:1 / span 3">${spots.join('')}</div>`);
  return parts.join('');
}

/** Cylindre en SVG : case i centrée à i × SEGMENT degrés depuis le haut, dans le sens horaire. */
export function wheelSvg(): string {
  const point = (angle: number, radius: number): string => {
    const rad = (angle * Math.PI) / 180;
    return `${(100 + radius * Math.sin(rad)).toFixed(2)} ${(100 - radius * Math.cos(rad)).toFixed(2)}`;
  };
  const pockets = EUROPEAN_WHEEL_ORDER.map((n, i) => {
    const start = (i - 0.5) * SEGMENT;
    const end = (i + 0.5) * SEGMENT;
    return (
      `<path d="M ${point(start, 97)} A 97 97 0 0 1 ${point(end, 97)} L ${point(end, 64)} A 64 64 0 0 0 ${point(start, 64)} Z" ` +
      `fill="${POCKET_FILLS[colorOf(n)]}" stroke="#d9c07a" stroke-width="0.6"/>` +
      `<text x="100" y="14" transform="rotate(${(i * SEGMENT).toFixed(3)} 100 100)" text-anchor="middle" ` +
      `dominant-baseline="central" font-size="8.5" font-weight="700" fill="#fff">${n}</text>`
    );
  }).join('');
  return (
    `<svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="99" fill="#3b2413"/>${pockets}` +
    `<circle cx="100" cy="100" r="64" fill="#4a2e17" stroke="#d9c07a" stroke-width="1"/>` +
    `<circle cx="100" cy="100" r="52" fill="none" stroke="rgba(217,192,122,0.35)" stroke-width="1"/></svg>`
  );
}
