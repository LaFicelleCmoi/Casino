import { mountBlackjack } from './blackjack-view.js';
import { mountCheatConsole, setCheatTarget } from './cheat-console.js';
import { mountHoldem } from './holdem-view.js';
import {
  loadLedger,
  netOf,
  saveBalance,
  startingBigBalance,
  totalOf,
  type GameKey,
  type GameStats,
  type Ledger,
} from './money-ledger.js';
import { isTableId } from './net/peer-link.js';
import { mountRoulette } from './roulette-view.js';
import { mountScratch } from './scratch-view.js';
import { mountRacing } from './racing-view.js';
import { mountPlinko } from './plinko-view.js';
import { mountMines } from './mines-view.js';
import { mountHilo } from './hilo-view.js';
import { mountPachinko } from './pachinko-view.js';
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
          ${ledgerRow('Mines', ledger.mines)}
          ${ledgerRow('Hi-Lo', ledger.hilo)}
          ${ledgerRow('Pachinko', ledger.pachinko)}
          ${ledgerRow('Total', totalOf(ledger), true)}
        </tbody>
      </table>
    </div>`;
}

/** Solde avec lequel on s'assiérait à la table, sans limite de taille (Roulette). */
const lobbyBalance = (game: GameKey): bigint => startingBigBalance(game);

const balanceHtml = (amount: bigint): string =>
  `<span class="tile-balance">Votre solde <strong>${formatChips(amount)} jetons</strong></span>`;

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
          <p>Plusieurs mains à la fois · devenez croupier : vos règles de la maison, pourboires et note de service · table partagée jusqu'à 8 joueurs</p>
          ${balanceHtml(lobbyBalance('blackjack'))}
          <span class="tile-cta">S'asseoir</span>
        </a>
        <a class="tile tile-holdem" href="#/holdem">
          <span class="tile-suits" aria-hidden="true">♣ ♦</span>
          <h2>Texas Hold'em</h2>
          <p>No-Limit 5/10 · jusqu'à 8 vrais joueurs via un lien · bots IA sur les sièges libres</p>
          ${balanceHtml(lobbyBalance('holdem'))}
          <span class="tile-cta">S'asseoir</span>
        </a>
        <a class="tile tile-roulette" href="#/roulette">
          <span class="tile-suits" aria-hidden="true">◉ 0</span>
          <h2>Roulette</h2>
          <p>Cylindre européen à un zéro · pleins 35:1, chevaux, carrés, sixains · mises sans aucune limite</p>
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
        <a class="tile tile-mines" href="#/mines">
          <span class="tile-suits" aria-hidden="true">💎 💣</span>
          <h2>Mines</h2>
          <p>Grille 5x5 · Nombre de bombes au choix · Cashout à tout moment · Multiplicateur progressif</p>
          ${balanceHtml(lobbyBalance('mines'))}
          <span class="tile-cta">Explorer</span>
        </a>
        <a class="tile tile-hilo" href="#/hilo">
          <span class="tile-suits" aria-hidden="true">▲ ▼</span>
          <h2>Hi-Lo</h2>
          <p>Devinez la carte suivante · Séries de victoires · Multiplicateurs de risque · Joker disponible</p>
          ${balanceHtml(lobbyBalance('hilo'))}
          <span class="tile-cta">Parier</span>
        </a>
        <a class="tile tile-pachinko" href="#/pachinko">
          <span class="tile-suits" aria-hidden="true">🎰 ✦</span>
          <h2>Pachinko</h2>
          <p>Pluie de billes en cascade · Poches bonus · Fever Mode · Multiplicateurs de métal</p>
          ${balanceHtml(lobbyBalance('pachinko'))}
          <span class="tile-cta">Lancer</span>
        </a>
      </div>
      <section class="ledger">${ledgerHtml(loadLedger())}</section>
      <footer class="lobby-footer">Jetons fictifs uniquement : aucun argent réel n'est en jeu.</footer>
    </main>`;
}

function mountLobby(root: HTMLElement): Unmount {
  root.innerHTML = lobbyHtml();

  setCheatTarget({
    games: ['blackjack', 'holdem', 'roulette', 'grattage', 'courses', 'plinko', 'mines', 'hilo', 'pachinko'],
    getBalance: lobbyBalance,
    setBalance: (game, amount) => {
      saveBalance(game, amount);
      root.innerHTML = lobbyHtml();
      return null;
    },
    refresh: () => {},
  });

  return () => setCheatTarget(null);
}

let unmount: Unmount = () => {};

/** « #/jeu » ou, pour une table partagée, « #/jeu/<identifiant de table> » (lien d'invitation). */
function parseHash(hash: string): { readonly game: string; readonly tableId: string | null } {
  const [, game = '', tableId] = /^#\/([a-z]+)(?:\/([^/]+))?$/.exec(hash) ?? [];
  return { game, tableId: tableId !== undefined && isTableId(tableId) ? tableId : null };
}

function route(): void {
  unmount();
  app.replaceChildren();
  window.scrollTo(0, 0);
  const { game, tableId } = parseHash(location.hash);
  switch (game) {
    case 'blackjack':
      unmount = mountBlackjack(app, tableId);
      break;
    case 'holdem':
      unmount = mountHoldem(app, tableId);
      break;
    case 'roulette':
      unmount = mountRoulette(app);
      break;
    case 'grattage':
      unmount = mountScratch(app);
      break;
    case 'courses':
      unmount = mountRacing(app);
      break;
    case 'plinko':
      unmount = mountPlinko(app);
      break;
    case 'mines':
      unmount = mountMines(app);
      break;
    case 'hilo':
      unmount = mountHilo(app);
      break;
    case 'pachinko':
      unmount = mountPachinko(app);
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
