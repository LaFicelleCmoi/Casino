import { CryptoRandomSource, chips, playerId, type PlayerId } from '../src/core/index.js';
import {
  MAX_MINES,
  MINES_GRID_SIZE,
  MINES_TILES,
  MIN_MINES,
  MinesController,
  STANDARD_MINES_RULES,
  formatMultiplier,
  minesMultiplier,
  nextDiamondChance,
  type MinesCommand,
  type MinesState,
} from '../src/mines/index.js';
import { setCheatTarget } from './cheat-console.js';
import { DAILY_REFILL, claimDailyRefill, loadLedger, netOf, recordResult, saveBalance, startingBalance } from './money-ledger.js';
import {
  REFILL_DONE_MESSAGE,
  REFILL_USED_MESSAGE,
  expectOk,
  formatChips,
  formatSigned,
  queryIn,
  refillButtonHtml,
  signClass,
  syncRefillButton,
} from './ui.js';

type Tone = 'info' | 'win' | 'loss' | 'error';

const PLAYER: PlayerId = playerId('vous');
const RULES = STANDARD_MINES_RULES;
const MINE_PRESETS = [1, 3, 5, 10, 24] as const;

const percent = (chance: number): string => `${Math.round(chance * 100)} %`;
const tileName = (tile: number): string => `ligne ${Math.floor(tile / MINES_GRID_SIZE) + 1}, colonne ${(tile % MINES_GRID_SIZE) + 1}`;

export function mountMines(root: HTMLElement): () => void {
  const controller = new MinesController(new CryptoRandomSource());
  let state: MinesState = expectOk(controller.createSession(PLAYER, startingBalance('mines')));
  let stake = 10;
  let mineCount = 3;
  let message = 'Choisissez votre mise et le nombre de bombes, puis explorez la grille.';
  let tone: Tone = 'info';
  /** Code MINESWEEPER : les bombes luisent sous les cases. */
  let xray = false;

  const tilesHtml = Array.from(
    { length: MINES_TILES },
    (_, tile) => `<button type="button" class="mn-tile" data-tile="${tile}" aria-label="Case ${tileName(tile)}"><span class="mn-face"></span></button>`,
  ).join('');

  root.innerHTML = `
    <div class="game mn-game">
      <header class="topbar">
        <a class="back" href="#/">← Lobby</a>
        <h1>Mines</h1>
        <div class="topbar-stats">
          <div class="bankroll">Bilan <strong data-ledger></strong></div>
          <div class="bankroll">Solde <strong data-bankroll></strong></div>
        </div>
      </header>
      <div class="mn-layout">
        <aside class="mn-controls">
          <label class="pk-label" for="mn-stake">Mise</label>
          <div class="pk-stake">
            <input id="mn-stake" type="number" min="1" step="1" inputmode="numeric" value="${stake}" data-stake>
            <button class="pk-mini" data-action="HALF" aria-label="Diviser la mise par deux">½</button>
            <button class="pk-mini" data-action="DOUBLE" aria-label="Doubler la mise">×2</button>
          </div>
          <label class="pk-label" for="mn-mines">Bombes : <strong data-mine-count></strong></label>
          <input id="mn-mines" type="range" min="${MIN_MINES}" max="${MAX_MINES}" step="1" value="${mineCount}" data-mines>
          <div class="mn-presets">${MINE_PRESETS.map((count) => `<button data-action="PRESET" data-value="${count}">${count}</button>`).join('')}</div>
          <div class="mn-stats" data-stats></div>
          <button class="btn primary mn-main" data-action="MAIN"></button>
          <button class="btn ghost" data-action="RANDOM">Case au hasard</button>
          ${refillButtonHtml('mines', 'ghost', 'hidden')}
          <p class="message mn-message" data-message aria-live="polite"></p>
        </aside>
        <section class="mn-board">
          <div class="mn-grid" data-grid aria-label="Grille de 5 cases sur 5">${tilesHtml}</div>
        </section>
      </div>
    </div>`;

  const ledgerEl = queryIn<HTMLElement>(root, '[data-ledger]');
  const bankrollEl = queryIn<HTMLElement>(root, '[data-bankroll]');
  const stakeEl = queryIn<HTMLInputElement>(root, '[data-stake]');
  const minesEl = queryIn<HTMLInputElement>(root, '[data-mines]');
  const mineCountEl = queryIn<HTMLElement>(root, '[data-mine-count]');
  const statsEl = queryIn<HTMLElement>(root, '[data-stats]');
  const mainEl = queryIn<HTMLButtonElement>(root, '[data-action="MAIN"]');
  const rebuyEl = queryIn<HTMLButtonElement>(root, '[data-action="REBUY"]');
  const messageEl = queryIn<HTMLElement>(root, '[data-message]');
  const tiles = [...root.querySelectorAll<HTMLButtonElement>('[data-tile]')];

  const safeStake = (): number => (Number.isSafeInteger(stake) && stake > 0 ? stake : 0);

  function apply(command: MinesCommand): boolean {
    const before = state.phase;
    const result = controller.apply(state, command);
    if (!result.ok) {
      [message, tone] = [result.error.message, 'error'];
      return false;
    }
    state = result.value.state;
    const current = state;
    if (before === 'PLAYING' && current.phase === 'IDLE' && current.lastRound !== null) {
      const round = current.lastRound;
      recordResult('mines', round.net);
      [message, tone] =
        round.outcome === 'BUSTED'
          ? [`💣 Boum ! Bombe ${tileName(round.hitMine ?? 0)} : vous perdez ${formatChips(round.stake)} jetons.`, 'loss']
          : [`Encaissé à ×${formatMultiplier(round.multiplier)} : ${formatChips(round.payout)} jetons (${formatSigned(round.net)}).`, 'win'];
    }
    return true;
  }

  function startRound(): boolean {
    if (!apply({ type: 'START_ROUND', playerId: PLAYER, stake: chips(safeStake()), mines: mineCount })) return false;
    [message, tone] = [`${mineCount} bombe${mineCount > 1 ? 's' : ''} cachée${mineCount > 1 ? 's' : ''} : bonne exploration !`, 'info'];
    return true;
  }

  function reveal(tile: number): void {
    if (state.phase === 'IDLE' && !startRound()) {
      render();
      return;
    }
    if (apply({ type: 'REVEAL', playerId: PLAYER, tile })) {
      const current = state;
      if (current.phase === 'PLAYING') [message, tone] = [`💎 Diamant ! Multiplicateur ×${formatMultiplier(current.round.multiplier)}.`, 'info'];
    }
    render();
  }

  function render(): void {
    const current = state;
    const playing = current.phase === 'PLAYING' ? current : null;
    const last = current.phase === 'IDLE' ? current.lastRound : null;

    saveBalance('mines', current.player.bankroll);
    bankrollEl.textContent = formatChips(current.player.bankroll);
    const net = netOf(loadLedger().mines);
    ledgerEl.textContent = formatSigned(net);
    ledgerEl.className = signClass(net);
    messageEl.textContent = message;
    messageEl.dataset['tone'] = tone;

    const count = playing?.round.mineCount ?? mineCount;
    const revealed = playing?.round.revealed.length ?? 0;
    mineCountEl.textContent = String(count);
    minesEl.value = String(count);
    minesEl.disabled = playing !== null;
    stakeEl.disabled = playing !== null;
    for (const preset of root.querySelectorAll<HTMLButtonElement>('[data-action="PRESET"]')) {
      preset.setAttribute('aria-pressed', String(Number(preset.dataset['value']) === count));
      preset.disabled = playing !== null;
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-action="HALF"], [data-action="DOUBLE"]')) button.disabled = playing !== null;

    const multiplier = playing?.round.multiplier ?? 100;
    statsEl.innerHTML = `
      <div class="mn-stat"><span>Multiplicateur</span><strong>×${formatMultiplier(multiplier)}</strong></div>
      <div class="mn-stat"><span>Prochain diamant</span><strong>×${formatMultiplier(minesMultiplier(count, revealed + 1, RULES.houseEdge))}</strong></div>
      <div class="mn-stat"><span>Chance</span><strong>${percent(nextDiamondChance(count, revealed))}</strong></div>
      <div class="mn-stat"><span>Diamants</span><strong>${revealed} / ${MINES_TILES - count}</strong></div>`;

    if (playing !== null) {
      const value = Math.floor((playing.round.stake * playing.round.multiplier) / 100);
      mainEl.textContent = revealed > 0 ? `Encaisser ${formatChips(value)} jetons` : 'Trouvez un diamant pour encaisser';
      mainEl.disabled = revealed === 0;
    } else {
      mainEl.textContent = 'Explorer';
      mainEl.disabled = false;
    }
    rebuyEl.hidden = playing !== null || current.player.bankroll >= RULES.minStake;
    syncRefillButton(rebuyEl, 'mines');

    tiles.forEach((tileEl, tile) => {
      let classes = 'mn-tile';
      let face = '';
      let disabled = false;
      if (playing !== null) {
        if (playing.round.revealed.includes(tile)) {
          classes += ' is-diamond';
          face = '💎';
          disabled = true;
        } else if (xray && playing.round.mines.includes(tile)) {
          classes += ' mn-xray';
        }
      } else if (last !== null) {
        if (last.mines.includes(tile)) {
          classes += tile === last.hitMine ? ' is-mine is-hit' : ' is-mine';
          face = '💣';
        } else {
          classes += last.revealed.includes(tile) ? ' is-diamond' : ' is-diamond is-ghost';
          face = '💎';
        }
      }
      tileEl.className = classes;
      tileEl.disabled = disabled;
      const faceEl = tileEl.querySelector('.mn-face');
      if (faceEl !== null) faceEl.textContent = face;
    });
  }

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const tileEl = event.target.closest<HTMLButtonElement>('[data-tile]');
    if (tileEl !== null) {
      if (!tileEl.disabled) reveal(Number(tileEl.dataset['tile']));
      return;
    }
    const button = event.target.closest<HTMLButtonElement>('button[data-action]');
    if (button === null || button.disabled) return;
    switch (button.dataset['action']) {
      case 'MAIN':
        if (state.phase === 'PLAYING') apply({ type: 'CASH_OUT', playerId: PLAYER });
        else startRound();
        render();
        break;
      case 'RANDOM': {
        const current = state;
        const explored = current.phase === 'PLAYING' ? current.round.revealed : [];
        const hidden = tiles.map((_, tile) => tile).filter((tile) => !explored.includes(tile));
        const tile = hidden[Math.floor(Math.random() * hidden.length)];
        if (tile !== undefined) reveal(tile);
        break;
      }
      case 'HALF':
      case 'DOUBLE':
        stake = Math.max(RULES.minStake, Math.min(RULES.maxStake, Math.floor(button.dataset['action'] === 'HALF' ? safeStake() / 2 : safeStake() * 2)));
        stakeEl.value = String(stake);
        break;
      case 'PRESET':
        mineCount = Number(button.dataset['value']);
        render();
        break;
      case 'REBUY':
        if (claimDailyRefill('mines')) {
          state = expectOk(controller.createSession(PLAYER, state.player.bankroll + DAILY_REFILL));
          [message, tone] = [REFILL_DONE_MESSAGE, 'win'];
        } else {
          [message, tone] = [REFILL_USED_MESSAGE, 'error'];
        }
        render();
        break;
    }
  }

  function onInput(event: Event): void {
    if (event.target === stakeEl) stake = Math.floor(Number(stakeEl.value));
    if (event.target === minesEl) {
      mineCount = Number(minesEl.value);
      render();
    }
  }

  setCheatTarget({
    games: ['mines'],
    getBalance: () => state.player.bankroll,
    setBalance: (_game, amount) => {
      state = { ...state, player: { ...state.player, bankroll: chips(amount) } };
      render();
      return null;
    },
    refresh: render,
    foresee: () => {
      const current = state;
      if (current.phase !== 'PLAYING') return 'Lancez une exploration : la voyance sent les bombes enfouies.';
      const safe = tiles.map((_, tile) => tile).filter((tile) => !current.round.mines.includes(tile) && !current.round.revealed.includes(tile));
      const tile = safe[Math.floor(Math.random() * safe.length)];
      return tile === undefined ? 'Il ne reste plus un seul diamant à trouver.' : `Une case sûre vous appelle : ${tileName(tile)}.`;
    },
    runCode: (code) => {
      if (code !== 'minesweeper') return null;
      xray = !xray;
      render();
      return xray
        ? 'MINESWEEPER : les bombes luisent en rouge sous les cases. Ne cliquez que les diamants.'
        : 'Les bombes redeviennent invisibles.';
    },
  });

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  render();

  return () => {
    const current = state;
    // Quitter en pleine exploration encaisse les diamants trouvés ; sans diamant, la mise est perdue.
    if (current.phase === 'PLAYING') {
      if (current.round.revealed.length > 0) apply({ type: 'CASH_OUT', playerId: PLAYER });
      else recordResult('mines', -current.round.stake);
    }
    saveBalance('mines', state.player.bankroll);
    setCheatTarget(null);
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
  };
}
