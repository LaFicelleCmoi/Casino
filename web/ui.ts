import type { Card, Result } from '../src/core/index.js';
import { DAILY_REFILL, canClaimDailyRefill, type GameKey } from './money-ledger.js';

const SUIT_SYMBOLS: Readonly<Record<Card['suit'], string>> = {
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
  spades: '♠',
};

const rankLabel = (card: Card): string => (card.rank === 'T' ? '10' : card.rank);

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Accepte aussi les bigint : la Roulette sans limite et le bilan dépassent les entiers sûrs. */
export function formatChips(amount: number | bigint): string {
  return amount.toLocaleString('fr-FR');
}

export function formatSigned(amount: number | bigint): string {
  if (amount === 0 || amount === 0n) return '0';
  if (amount > 0) return `+${formatChips(amount)}`;
  return `−${formatChips(typeof amount === 'bigint' ? -amount : -amount)}`;
}

/** Classe de couleur pour un montant net : vert si positif, rouge si négatif. */
export function signClass(amount: number | bigint): string {
  if (amount === 0 || amount === 0n) return '';
  return amount > 0 ? 'pos' : 'neg';
}

export function cardText(card: Card): string {
  return `${rankLabel(card)}${SUIT_SYMBOLS[card.suit]}`;
}

/** L'UI ne sert que de démo : une erreur ici est un bug de câblage, pas une action refusée. */
export function expectOk<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

interface CardOptions {
  readonly animate?: boolean;
  readonly delay?: number;
  readonly small?: boolean;
  /** Carte normalement cachée, dévoilée par le code « rayons-x ». */
  readonly xray?: boolean;
}

/** `null` = carte face cachée. */
export function cardHtml(card: Card | null, options: CardOptions = {}): string {
  const classes = ['card'];
  if (options.small) classes.push('card-sm');
  if (options.animate) classes.push('deal');
  if (options.xray) classes.push('xray');
  const style = options.animate ? ` style="animation-delay:${options.delay ?? 0}ms"` : '';

  if (card === null) {
    return `<div class="${classes.join(' ')} back"${style} aria-label="Carte cachée"></div>`;
  }
  if (card.suit === 'hearts' || card.suit === 'diamonds') classes.push('red');
  const rank = rankLabel(card);
  const suit = SUIT_SYMBOLS[card.suit];
  return (
    `<div class="${classes.join(' ')}"${style} aria-label="${rank} ${suit}">` +
    `<span class="corner">${rank}<br>${suit}</span><span class="pip">${suit}</span>` +
    `<span class="corner flip">${rank}<br>${suit}</span></div>`
  );
}

/** Anime uniquement les cartes qui apparaissent, en cascade, grâce à une clé stable par carte. */
export class DealAnimator {
  readonly #seen = new Set<string>();
  #queued = 0;

  beginFrame(): void {
    this.#queued = 0;
  }

  card(key: string, card: Card | null, small = false, xray = false): string {
    const isNew = !this.#seen.has(key);
    this.#seen.add(key);
    const delay = isNew ? Math.min(this.#queued++, 8) * 110 : 0;
    return cardHtml(card, { animate: isNew, delay, small, xray });
  }
}

const renderedHtml = new WeakMap<Element, string>();

/**
 * Remplace le contenu d'un élément seulement s'il a changé. À une table partagée, les rafraîchissements venus
 * des autres joueurs ne recréent donc pas le bouton sur lequel on est en train de cliquer.
 */
export function setHtml(element: Element, html: string): void {
  if (renderedHtml.get(element) === html) return;
  renderedHtml.set(element, html);
  element.innerHTML = html;
}

export function queryIn<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Élément ${selector} introuvable`);
  return element;
}

export const REFILL_DONE_MESSAGE = `Recharge du jour : +${formatChips(DAILY_REFILL)} jetons. Bonne chance !`;
export const REFILL_USED_MESSAGE = 'Recharge du jour déjà utilisée pour ce jeu : revenez demain.';

/** Libellé du bouton de recharge quotidienne, selon qu'elle reste disponible aujourd'hui. */
export function refillLabel(game: GameKey): string {
  return canClaimDailyRefill(game)
    ? `Récupérer ${formatChips(DAILY_REFILL)} jetons · 1 fois par jour`
    : 'Recharge du jour utilisée · revenez demain';
}

/** Bouton de recharge quotidienne (action REBUY), grisé une fois la recharge du jour prise. */
export function refillButtonHtml(game: GameKey, variant = 'primary', attributes = ''): string {
  const disabled = canClaimDailyRefill(game) ? '' : ' disabled';
  return `<button class="btn ${variant}" data-action="REBUY"${disabled}${attributes ? ` ${attributes}` : ''}>${refillLabel(game)}</button>`;
}

/** Remet à jour un bouton de recharge déjà présent dans la page. */
export function syncRefillButton(button: HTMLButtonElement, game: GameKey): void {
  button.disabled = !canClaimDailyRefill(game);
  button.textContent = refillLabel(game);
}
