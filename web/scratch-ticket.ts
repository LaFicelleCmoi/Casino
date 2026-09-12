import {
  wordCells,
  type CellGroup,
  type CrosswordBoard,
  type ScratchCell,
  type ScratchZone,
  type Ticket,
  type TicketEvaluation,
  type TicketTypeId,
} from '../src/scratch/index.js';
import { escapeHtml, formatChips } from './ui.js';

/** Classe de thème visuel de chaque ticket (carte du catalogue et ticket gratté). */
export const TICKET_THEMES: Readonly<Record<TicketTypeId, string>> = {
  BANCO: 'banco',
  CASH: 'cash',
  MORPION: 'morpion',
  MILLIONNAIRE: 'millionnaire',
  VEGAS: 'vegas',
  MOTS_CROISES: 'mots',
  MAXI_MOTS_CROISES: 'maxi-mots',
  MEGA_MOTS_CROISES: 'mega-mots',
  ASTRO: 'astro',
  POLE_POSITION: 'pole',
};

const BRUSH_RADIUS = 15;
const REVEAL_RATIO = 0.55;

const WRENCH_ICON = `<svg class="sc-icon" viewBox="0 0 64 40" aria-hidden="true">
  <rect x="2" y="11" width="28" height="17" rx="5" fill="#d9d9d9"/><rect x="30" y="15" width="18" height="9" fill="#8f8f8f"/>
  <rect x="48" y="12" width="13" height="15" rx="2" fill="#e10600"/><rect x="9" y="26" width="11" height="13" rx="3" fill="#2b2b2b"/>
  <circle cx="16" cy="19" r="3" fill="#e10600"/></svg>`;
const TIRE_ICON = `<svg class="sc-icon" viewBox="0 0 40 40" aria-hidden="true">
  <circle cx="20" cy="20" r="18" fill="#101010"/><circle cx="20" cy="20" r="11.5" fill="#262626" stroke="#e10600" stroke-width="2"/>
  <circle cx="20" cy="20" r="4" fill="#bdbdbd"/></svg>`;

/** Ce qui est imprimé sous la pellicule d'une case. */
export function cellFace(cell: ScratchCell): string {
  switch (cell.symbol) {
    case 'AMOUNT':
      return `<strong class="sc-amount">${escapeHtml(cell.label)}</strong>`;
    case 'GREEN_LIGHT':
      return '<span class="sc-light sc-light-green" title="Feu vert"></span>';
    case 'RED_LIGHT':
      return '<span class="sc-light sc-light-red" title="Feu rouge"></span>';
    case 'IMPACT_WRENCH':
      return `${WRENCH_ICON}<small class="sc-caption">Pistolet · ×5</small>`;
    case 'TIRE':
      return `${TIRE_ICON}<small class="sc-caption">Pneu</small>`;
    case 'LAP_TIME':
      return `<strong class="sc-chrono">${escapeHtml(cell.label)}</strong>`;
    case 'EMPTY':
      return `<span class="sc-muted">${escapeHtml(cell.label)}</span>`;
    default: {
      const amount = cell.amount === null ? '' : `<small class="sc-cell-amount">${formatChips(cell.amount)}</small>`;
      return `<span class="sc-sym">${escapeHtml(cell.label)}</span>${amount}`;
    }
  }
}

function boardHtml(board: CrosswordBoard): string {
  const cells = new Map<string, { row: number; column: number; letter: string; words: number[] }>();
  board.words.forEach((placed, index) => {
    for (const { row, column, letter } of wordCells(placed)) {
      const key = `${row},${column}`;
      const existing = cells.get(key);
      if (existing === undefined) cells.set(key, { row, column, letter, words: [index] });
      else existing.words.push(index);
    }
  });
  const entries = [...cells.values()];
  const minRow = Math.min(...entries.map((cell) => cell.row));
  const minColumn = Math.min(...entries.map((cell) => cell.column));
  const rows = Math.max(...entries.map((cell) => cell.row)) - minRow + 1;
  const columns = Math.max(...entries.map((cell) => cell.column)) - minColumn + 1;
  const html = entries
    .map(
      (cell) =>
        `<span class="sc-board-cell" data-letter="${cell.letter}" data-words="${cell.words.join(' ')}" ` +
        `style="grid-row:${cell.row - minRow + 1};grid-column:${cell.column - minColumn + 1}">${cell.letter}</span>`,
    )
    .join('');
  return `<div class="sc-board-scroll"><div class="sc-board" style="--board-columns:${columns};--board-rows:${rows}">${html}</div></div>`;
}

function groupHtml(cellGroup: CellGroup): string {
  const cells = cellGroup.cells
    .map(
      (cell) =>
        `<div class="sc-cell sc-symbol-${cell.symbol.toLowerCase()}" data-cell="${cell.id}">` +
        `<div class="sc-face">${cellFace(cell)}</div><canvas class="sc-film" aria-hidden="true"></canvas></div>`,
    )
    .join('');
  return `
    <div class="sc-group sc-group-${cellGroup.id}">
      <span class="sc-group-label">${escapeHtml(cellGroup.label)}</span>
      <div class="sc-cells" style="--columns:${cellGroup.columns}">${cells}</div>
    </div>`;
}

function zoneHtml(zone: ScratchZone): string {
  const hasCells = zone.groups.some((cellGroup) => cellGroup.cells.length > 0);
  return `
    <section class="sc-zone" data-zone="${zone.id}">
      <header class="sc-zone-head">
        <h3>${escapeHtml(zone.title)}</h3>
        ${hasCells ? `<button type="button" class="sc-zone-scratch" data-action="SCRATCH_ZONE" data-zone="${zone.id}">Gratter</button>` : ''}
        <span class="sc-zone-badge" data-zone-badge="${zone.id}"></span>
      </header>
      <p class="sc-rule">${escapeHtml(zone.rule)}</p>
      ${zone.board === null ? '' : boardHtml(zone.board)}
      ${zone.groups.map(groupHtml).join('')}
      <p class="sc-zone-detail" data-zone-detail="${zone.id}"></p>
    </section>`;
}

export function ticketHtml(ticket: Ticket, name: string): string {
  return `
    <article class="sc-ticket sc-theme-${TICKET_THEMES[ticket.type]}" data-ticket>
      <div class="sc-ticket-inner">
        <header class="sc-ticket-head">
          <h2>${escapeHtml(name)}</h2>
          <div class="sc-ticket-meta"><span>${formatChips(ticket.price)} jetons</span><span class="sc-serial">N° ${escapeHtml(ticket.serial)}</span></div>
        </header>
        <div class="sc-zones">${ticket.zones.map(zoneHtml).join('')}</div>
        <div class="sc-result" data-result aria-live="polite" hidden></div>
      </div>
    </article>`;
}

/** Surligne dans la grille de mots croisés chaque occurrence d'une lettre découverte. */
export function markLetter(ticketElement: HTMLElement, letter: string): void {
  for (const cell of ticketElement.querySelectorAll<HTMLElement>('.sc-board-cell')) {
    if (cell.dataset['letter'] === letter) cell.classList.add('sc-letter-found');
  }
}

export function showEvaluation(ticketElement: HTMLElement, evaluation: TicketEvaluation): void {
  for (const result of evaluation.zones) {
    const badge = ticketElement.querySelector<HTMLElement>(`[data-zone-badge="${result.zoneId}"]`);
    if (badge !== null) {
      const isMultiplier = result.zoneId === 'pit';
      badge.textContent = isMultiplier ? `×${evaluation.multiplier}` : result.won ? `+${formatChips(result.amount)}` : 'Perdu';
      badge.className = `sc-zone-badge ${result.won ? 'is-won' : 'is-lost'}`;
    }
    const detail = ticketElement.querySelector<HTMLElement>(`[data-zone-detail="${result.zoneId}"]`);
    if (detail !== null) detail.textContent = result.detail;

    for (const mark of result.marks) {
      if (mark.startsWith('word:')) {
        const index = mark.slice('word:'.length);
        for (const cell of ticketElement.querySelectorAll<HTMLElement>('.sc-board-cell')) {
          if ((cell.dataset['words'] ?? '').split(' ').includes(index)) cell.classList.add('sc-word-win');
        }
      } else {
        ticketElement.querySelector(`[data-cell="${CSS.escape(mark)}"]`)?.classList.add('sc-win');
      }
    }
  }

  const banner = ticketElement.querySelector<HTMLElement>('[data-result]');
  if (banner === null) return;
  banner.hidden = false;
  banner.className = `sc-result ${evaluation.total > 0 ? 'is-won' : 'is-lost'}`;
  banner.innerHTML =
    evaluation.total > 0
      ? `<strong>Gagné : ${formatChips(evaluation.total)} jetons</strong>${evaluation.multiplier > 1 ? `<span>Pit-Stop Bonus : gains ×${evaluation.multiplier}</span>` : ''}`
      : '<strong>Perdu</strong><span>Ce ticket ne rapporte rien, retentez votre chance !</span>';
}

function filmContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext('2d', { willReadFrequently: true });
}

/** Pellicule métallisée aux couleurs du thème (--film-light, --film-dark, --film-ink). */
function paintFilm(canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect();
  const context = filmContext(canvas);
  if (rect.width === 0 || rect.height === 0 || context === null) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);

  const style = getComputedStyle(canvas);
  const light = style.getPropertyValue('--film-light').trim() || '#dfe2e6';
  const dark = style.getPropertyValue('--film-dark').trim() || '#9aa0a8';
  const ink = style.getPropertyValue('--film-ink').trim() || 'rgba(40, 44, 52, 0.4)';

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.globalCompositeOperation = 'source-over';
  const gradient = context.createLinearGradient(0, 0, rect.width, rect.height);
  gradient.addColorStop(0, light);
  gradient.addColorStop(0.5, dark);
  gradient.addColorStop(1, light);
  context.fillStyle = gradient;
  context.fillRect(0, 0, rect.width, rect.height);

  context.fillStyle = 'rgba(255, 255, 255, 0.22)';
  for (let i = 0; i < (rect.width * rect.height) / 80; i += 1) {
    context.fillRect(Math.random() * rect.width, Math.random() * rect.height, 1, 1);
  }
  if (rect.width >= 46 && rect.height >= 30) {
    context.fillStyle = ink;
    context.font = `800 ${Math.min(11, rect.height / 3.4)}px Inter, system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('GRATTEZ', rect.width / 2, rect.height / 2);
  }
}

/**
 * Grattage à la souris ou au doigt. Un geste peut passer d'une case à l'autre ; une case est considérée grattée
 * quand plus de REVEAL_RATIO de sa pellicule est retirée, et `onScratched` prévient alors le moteur.
 */
export class ScratchSurface {
  readonly #root: HTMLElement;
  readonly #onScratched: (cellId: string) => void;
  readonly #last = new Map<HTMLCanvasElement, { x: number; y: number }>();
  readonly #touched = new Set<HTMLCanvasElement>();
  #active = false;
  #moves = 0;

  constructor(root: HTMLElement, onScratched: (cellId: string) => void) {
    this.#root = root;
    this.#onScratched = onScratched;
    root.addEventListener('pointerdown', this.#down);
    window.addEventListener('pointermove', this.#move);
    window.addEventListener('pointerup', this.#up);
    window.addEventListener('pointercancel', this.#up);
  }

  /** (Re)peint les pellicules encore en place, par exemple après un redimensionnement. */
  paint(): void {
    for (const canvas of this.#root.querySelectorAll<HTMLCanvasElement>('canvas.sc-film')) {
      if (canvas.dataset['done'] === undefined) paintFilm(canvas);
    }
  }

  reveal(cellId: string): void {
    const cell = this.#root.querySelector<HTMLElement>(`[data-cell="${CSS.escape(cellId)}"]`);
    if (cell === null) return;
    cell.classList.add('sc-revealed');
    const canvas = cell.querySelector<HTMLCanvasElement>('canvas.sc-film');
    if (canvas === null) return;
    canvas.dataset['done'] = '1';
    canvas.classList.add('sc-film-gone');
    window.setTimeout(() => canvas.remove(), 450);
  }

  destroy(): void {
    this.#root.removeEventListener('pointerdown', this.#down);
    window.removeEventListener('pointermove', this.#move);
    window.removeEventListener('pointerup', this.#up);
    window.removeEventListener('pointercancel', this.#up);
  }

  readonly #down = (event: PointerEvent): void => {
    if (event.button !== 0 || !(event.target instanceof HTMLCanvasElement) || !event.target.classList.contains('sc-film')) return;
    event.preventDefault();
    this.#active = true;
    this.#last.clear();
    this.#scratchAt(event);
  };

  readonly #move = (event: PointerEvent): void => {
    if (this.#active) this.#scratchAt(event);
  };

  readonly #up = (): void => {
    if (!this.#active) return;
    this.#active = false;
    this.#last.clear();
    for (const canvas of this.#touched) this.#check(canvas);
    this.#touched.clear();
  };

  #scratchAt(event: PointerEvent): void {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!(target instanceof HTMLCanvasElement) || !target.classList.contains('sc-film') || target.dataset['done'] !== undefined || !this.#root.contains(target)) {
      this.#last.clear();
      return;
    }
    const context = filmContext(target);
    if (context === null) return;
    const rect = target.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const from = this.#last.get(target) ?? point;
    const ratio = target.width / rect.width;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.globalCompositeOperation = 'destination-out';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = BRUSH_RADIUS * 2;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(point.x + 0.01, point.y);
    context.stroke();

    this.#last.clear();
    this.#last.set(target, point);
    this.#touched.add(target);
    this.#moves += 1;
    if (this.#moves % 8 === 0) this.#check(target);
  }

  #check(canvas: HTMLCanvasElement): void {
    if (canvas.dataset['done'] !== undefined || canvas.width === 0 || canvas.height === 0) return;
    const context = filmContext(canvas);
    if (context === null) return;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let cleared = 0;
    let sampled = 0;
    for (let alpha = 3; alpha < pixels.length; alpha += 4 * 11) {
      sampled += 1;
      if (pixels[alpha] === 0) cleared += 1;
    }
    if (sampled === 0 || cleared / sampled < REVEAL_RATIO) return;
    const cellId = canvas.closest<HTMLElement>('[data-cell]')?.dataset['cell'];
    if (cellId !== undefined) this.#onScratched(cellId);
  }
}
