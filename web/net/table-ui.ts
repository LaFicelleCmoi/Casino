import type { GameKey } from '../money-ledger.js';
import { escapeHtml, formatChips, refillButtonHtml } from '../ui.js';
import { MAX_TABLE_PLAYERS } from './peer-link.js';

/** Message des codes de triche pour un invité : seules les tables créées sur cet appareil acceptent les triches. */
export const GUEST_CHEAT_LOCK = 'Triches réservées au créateur de la table.';

export interface ShareBarState {
  readonly mode: 'solo' | 'opening' | 'host' | 'guest';
  readonly name: string;
  readonly link: string | null;
  /** Joueurs réels à la table, créateur compris. */
  readonly players: number;
}

const nameField = (name: string): string =>
  `<label class="share-name">Pseudo <input type="text" data-player-name maxlength="16" autocomplete="nickname" value="${escapeHtml(name)}"></label>`;

/** Bandeau de partage : pseudo, bouton d'invitation puis lien à copier, nombre de joueurs reliés. */
export function shareBarHtml(state: ShareBarState): string {
  const count = `<span class="share-count">${state.players}/${MAX_TABLE_PLAYERS} joueurs</span>`;
  switch (state.mode) {
    case 'solo':
    case 'opening':
      return (
        nameField(state.name) +
        `<button class="btn" data-action="INVITE" ${state.mode === 'opening' ? 'disabled' : ''}>` +
        `${state.mode === 'opening' ? 'Ouverture de la table…' : 'Inviter des joueurs'}</button>` +
        `<span class="share-hint">Jouez avec jusqu'à ${MAX_TABLE_PLAYERS - 1} amis grâce à un lien</span>`
      );
    case 'host':
      return (
        nameField(state.name) +
        `<input class="share-link" type="text" readonly data-share-link aria-label="Lien d'invitation" value="${escapeHtml(state.link ?? '')}">` +
        `<button class="btn primary" data-action="COPY_LINK">Copier le lien</button>${count}`
      );
    case 'guest':
      return `${nameField(state.name)}<span class="share-hint">Table partagée : le créateur doit garder sa page ouverte</span>${count}`;
  }
}

export interface JoinPanelState {
  readonly game: GameKey;
  readonly gameLabel: string;
  readonly name: string;
  readonly balance: number;
  readonly minimum: number;
  readonly connecting: boolean;
  readonly error: string | null;
}

/** Écran d'arrivée d'un invité : pseudo, solde apporté, puis connexion (ou recharge du jour si le solde est trop bas). */
export function joinPanelHtml(state: JoinPanelState): string {
  const action =
    state.balance < state.minimum
      ? refillButtonHtml(state.game)
      : `<button class="btn primary" data-action="JOIN" ${state.connecting ? 'disabled' : ''}>${state.connecting ? 'Connexion…' : 'Rejoindre la table'}</button>`;
  return `
    <div class="join-panel">
      <h2>Rejoindre une table de ${escapeHtml(state.gameLabel)}</h2>
      <p>Vous jouez avec votre propre solde : <strong>${formatChips(state.balance)} jetons</strong></p>
      <label class="share-name">Pseudo <input type="text" data-player-name maxlength="16" autocomplete="nickname" value="${escapeHtml(state.name)}"></label>
      ${state.error === null ? '' : `<p class="join-error">${escapeHtml(state.error)}</p>`}
      <div class="join-actions">${action}<a class="btn ghost" href="#/${state.game}">Jouer seul</a></div>
    </div>`;
}
