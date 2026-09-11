import { mountBlackjack } from './blackjack-view.js';
import { mountHoldem } from './holdem-view.js';

type Unmount = () => void;

const container = document.querySelector<HTMLElement>('#app');
if (container === null) throw new Error('#app introuvable');
const app: HTMLElement = container;

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
      <footer class="lobby-footer">Jetons fictifs uniquement : aucun argent réel n'est en jeu.</footer>
    </main>`;
  return () => {};
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
