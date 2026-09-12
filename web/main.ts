import { STANDARD_HOLDEM_RULES } from '../src/holdem/index.js';
import { mountBlackjack } from './blackjack-view.js';
import { mountCheatConsole, setCheatTarget } from './cheat-console.js';
import { mountHoldem } from './holdem-view.js';
import {
  loadLedger,
  netOf,
  resetLedger,
  saveBalance,
  startingBalance,
  totalOf,
  type GameKey,
  type GameStats,
  type Ledger,
} from './money-ledger.js';
import { mountRoulette } from './roulette-view.js';
import { mountScratch } from './scratch-view.js';
import { mountRacing } from './racing-view.js';
import { mountPlinko } from './plinko-view.js';
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
          ${ledgerRow('Roulette', ledger.roulette)}
          ${ledgerRow('Tickets à gratter', ledger.grattage)}
          ${ledgerRow('Courses hippiques', ledger.courses)}
          ${ledgerRow('Plinko', ledger.plinko)}
          ${ledgerRow('Total', totalOf(ledger), true)}
        </tbody>
      </table>
    </div>`;
}

/** Solde avec lequel on s'assiérait à la table (recave incluse). */
const lobbyBalance = (game: GameKey): number =>
  startingBalance(game, game === 'holdem' ? STANDARD_HOLDEM_RULES.bigBlind : 1);

const balanceHtml = (amount: number): string =>
  `<span class="tile-balance">Votre solde : <strong>${formatChips(amount)}</strong> jetons</span>`;

function lobbyHtml(): string {
  return `
    <main class="lobby">
      <header class="lobby-header">
        <p class="eyebrow">Casino Engine</p>
        <h1>Choisissez votre table</h1>
        <p class="lede">Tables de casino et tickets à gratter, propulsés par des moteurs TypeScript : state machine stricte, tirage cryptographique, projection anti-triche.</p>
      </header>
      <div class="tiles">
        <a class="tile tile-blackjack" href="#/blackjack">
          <span class="tile-suits" aria-hidden="true">♠ ♥</span>
          <h2>Blackjack</h2>
          <p>6 decks · croupier S17 · Blackjack 3:2 · split, double, assurance</p>
          ${balanceHtml(lobbyBalance('blackjack'))}
          <span class="tile-cta">S'asseoir</span>
        </a>
        <a class="tile tile-holdem" href="#/holdem">
          <span class="tile-suits" aria-hidden="true">♣ ♦</span>
          <h2>Texas Hold'em</h2>
          <p>No-Limit 5/10 · 5 adversaires IA · side pots et départage par kickers</p>
          ${balanceHtml(lobbyBalance('holdem'))}
          <span class="tile-cta">S'asseoir</span>
        </a>
        <a class="tile tile-roulette" href="#/roulette">
          <span class="tile-suits" aria-hidden="true">◉ 0</span>
          <h2>Roulette</h2>
          <p>Cylindre européen à un zéro · pleins 35:1, chevaux, carrés, sixains · chances simples</p>
          ${balanceHtml(lobbyBalance('roulette'))}
          <span class="tile-cta">S'asseoir</span>
        </a>
        <a class="tile tile-scratch" href="#/grattage">
          <span class="tile-suits" aria-hidden="true">✦ ✧</span>
          <h2>Tickets à gratter</h2>
          <p>10 jeux instantanés · Banco, Cash, Morpion, Millionnaire, Vegas, Mots Croisés, Astro, Pole Position Jackpot</p>
          ${balanceHtml(lobbyBalance('grattage'))}
          <span class="tile-cta">Gratter</span>
        </a>
        <a class="tile tile-racing" href="#/courses">
          <span class="tile-suits" aria-hidden="true">🐎 ⏱️</span>
          <h2>Courses Hippiques</h2>
          <p>Courses virtuelles 3D · Simple Gagnant / Placé · Tiercé &amp; Quinté</p>
          ${balanceHtml(lobbyBalance('courses'))}
          <span class="tile-cta">Parier</span>
        </a>
        <a class="tile tile-plinko" href="#/plinko">
          <span class="tile-suits" aria-hidden="true">🔺 💰</span>
          <h2>Plinko</h2>
          <p>Pyramide à 16 rangées · Volatilité ajustable · Chutes simultanées · Multiplicateurs extrêmes</p>
          ${balanceHtml(lobbyBalance('plinko'))}
          <span class="tile-cta">Lâcher</span>
        </a>
      </div>
      <section class="ledger">${ledgerHtml(loadLedger())}</section>
      <footer class="lobby-footer">Jetons fictifs uniquement : aucun argent réel n'est en jeu.</footer>
    </main>`;
}

function mountLobby(root: HTMLElement): Unmount {
  root.innerHTML = lobbyHtml();

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element) || event.target.closest('[data-action="RESET_LEDGER"]') === null) return;
    if (!window.confirm('Remettre à zéro le bilan et revenir à 1 000 jetons dans chaque jeu ?')) return;
    resetLedger();
    root.innerHTML = lobbyHtml();
  }

  setCheatTarget({
    games: ['blackjack', 'holdem', 'roulette', 'grattage', 'courses', 'plinko'],
    getBalance: lobbyBalance,
    setBalance: (game, amount) => {
      saveBalance(game, amount);
      root.innerHTML = lobbyHtml();
      return null;
    },
    refresh: () => {},
  });

  root.addEventListener('click', onClick);
  return () => {
    setCheatTarget(null);
    root.removeEventListener('click', onClick);
  };
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
    case '#/roulette':
      unmount = mountRoulette(app);
      break;
    case '#/grattage':
      unmount = mountScratch(app);
      break;
    case '#/courses':
      unmount = mountRacing(app);
      break;
    case '#/plinko':
      unmount = mountPlinko(app);
      break;
    default:
      unmount = mountLobby(app);
  }
}

// Fermer l'onglet en pleine manche équivaut à quitter la table : le bilan et le solde restent cohérents.
window.addEventListener('pagehide', () => {
  unmount();
  unmount = () => {};
});
// Page restaurée depuis le cache de navigation : on se rassoit avec le solde sauvegardé.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) route();
});
window.addEventListener('hashchange', route);
mountCheatConsole();
route();
