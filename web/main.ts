import { mountBlackjack } from './blackjack-view.js';
import { mountHoldem } from './holdem-view.js';
import { loadLedger, netOf, resetLedger, totalOf, type GameStats, type Ledger } from './money-ledger.js';
import { formatChips, formatSigned, signClass } from './ui.js';

type Unmount = () => void;

const container = document.querySelector<HTMLElement>('#app');
if (container === null) throw new Error('#app introuvable');
const app: HTMLElement = container;

function ledgerRow(label: string, stats: GameStats, total = false): string {
  const net = netOf(stats);
  return `
    <tr class="${total ? 'ledger-total' : ''}">
      <th scope="row">${label}</th>
      <td>${formatChips(stats.rounds)}</td>
      <td class="pos">+${formatChips(stats.won)}</td>
      <td class="neg">−${formatChips(stats.lost)}</td>
      <td class="${signClass(net)}">${formatSigned(net)}</td>
    </tr>`;
}

function ledgerHtml(ledger: Ledger): string {
  return `
    <div class="ledger-head">
      <h2>Votre bilan</h2>
      <button class="btn ghost" data-action="RESET_LEDGER">Réinitialiser</button>
    </div>
    <div class="ledger-scroll">
      <table class="ledger-table">
        <thead><tr><th></th><th>Manches</th><th>Gagné</th><th>Perdu</th><th>Net</th></tr></thead>
        <tbody>
          ${ledgerRow('Blackjack', ledger.blackjack)}
          ${ledgerRow("Texas Hold'em", ledger.holdem)}
          ${ledgerRow('Total', totalOf(ledger), true)}
        </tbody>
      </table>
    </div>`;
}

function mountLobby(root: HTMLElement): Unmount {
  root.innerHTML = `
    <main class="lobby">
      <header class="lobby-header">
        <p class="eyebrow">Casino Engine</p>
        <h1>Choisissez votre table</h1>
        <p class="lede">Deux moteurs de jeu en TypeScript : state machine stricte, mélange cryptographique, projection anti-triche.</p>
      </header>
      <div class="tiles">
        <a class="tile tile-blackjack" href="#/blackjack">
          <span class="tile-suits" aria-hidden="true">♠ ♥</span>
          <h2>Blackjack</h2>
          <p>6 decks · croupier S17 · Blackjack 3:2 · split, double, assurance</p>
          <span class="tile-cta">S'asseoir</span>
        </a>
        <a class="tile tile-holdem" href="#/holdem">
          <span class="tile-suits" aria-hidden="true">♣ ♦</span>
          <h2>Texas Hold'em</h2>
          <p>No-Limit 5/10 · 5 adversaires IA · side pots et départage par kickers</p>
          <span class="tile-cta">S'asseoir</span>
        </a>
      </div>
      <section class="ledger" data-ledger>${ledgerHtml(loadLedger())}</section>
      <footer class="lobby-footer">Jetons fictifs uniquement : aucun argent réel n'est en jeu.</footer>
    </main>`;

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element) || event.target.closest('[data-action="RESET_LEDGER"]') === null) return;
    if (!window.confirm('Remettre à zéro le bilan des gains et pertes ?')) return;
    const section = root.querySelector<HTMLElement>('[data-ledger]');
    if (section !== null) section.innerHTML = ledgerHtml(resetLedger());
  }

  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

let unmount: Unmount = () => {};

function route(): void {
  unmount();
  app.replaceChildren();
  window.scrollTo(0, 0);
  switch (location.hash) {
    case '#/blackjack':
      unmount = mountBlackjack(app);
      break;
    case '#/holdem':
      unmount = mountHoldem(app);
      break;
    default:
      unmount = mountLobby(app);
  }
}

window.addEventListener('hashchange', route);
route();
