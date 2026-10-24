import { CryptoRandomSource, chips, playerId, type PlayerId } from '../src/core/index.js';
import {
  CoinflipController,
  STANDARD_COINFLIP_RULES,
  coinflipHouseEdge,
  type CoinSide,
  type CoinflipCommand,
  type CoinflipResult,
  type CoinflipState,
} from '../src/coinflip/index.js';
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
const RULES = STANDARD_COINFLIP_RULES;
const STAKE_PRESETS = [10, 50, 100, 500, 1000] as const;
/** Lancers affichés dans le bandeau d'historique. */
const HISTORY_SHOWN = 24;
const FLIP_MS = 1400;
const REDUCED_FLIP_MS = 350;

const LABELS: Record<CoinSide, string> = { PILE: 'Pile', FACE: 'Face' };
/** Angle de la pièce posée sur chaque côté : Face vers le joueur à 0°, Pile à 180°. */
const SIDE_ANGLE: Record<CoinSide, number> = { FACE: 0, PILE: 180 };
const multiplierText = `×${((RULES.payout.numerator / RULES.payout.denominator)).toFixed(2).replace('.', ',')}`;
const percent = (value: number): string => `${Math.round(value * 100)} %`;

export function mountPileFace(root: HTMLElement): () => void {
  const controller = new CoinflipController(new CryptoRandomSource());
  let state: CoinflipState = expectOk(controller.createSession(PLAYER, startingBalance('pileface')));
  let stake = 10;
  let call: CoinSide = 'FACE';
  let message = `Choisissez Pile ou Face, votre mise, puis lancez la pièce. Un bon pronostic paie ${multiplierText}.`;
  let tone: Tone = 'info';
  /** Lancer en vol : le résultat est déjà réglé par le moteur, l'écran le dévoile à l'atterrissage. */
  let flying: CoinflipResult | null = null;
  /** Solde affiché pendant le vol, d'avant le lancer, pour ne pas trahir le résultat. */
  let shownBankroll: number = state.player.bankroll;
  let angle = SIDE_ANGLE.FACE;
  let timer: number | undefined;
  /** Code DOUBLEFACE : la pièce tombe toujours du côté annoncé. */
  let rigged = false;

  root.innerHTML = `
    <div class="game pf-game">
      <header class="topbar">
        <a class="back" href="#/">← Lobby</a>
        <h1>Pile ou Face</h1>
        <div class="topbar-stats">
          <div class="bankroll">Bilan <strong data-ledger></strong></div>
          <div class="bankroll">Solde <strong data-bankroll></strong></div>
        </div>
      </header>
      <div class="pf-layout">
        <aside class="pf-controls">
          <span class="pk-label">Votre pari</span>
          <div class="pf-calls" role="group" aria-label="Côté parié">
            <button type="button" class="pf-call" data-action="CALL" data-side="PILE"><span class="pf-call-coin pf-pile-mini">1</span>Pile<kbd>P</kbd></button>
            <button type="button" class="pf-call" data-action="CALL" data-side="FACE"><span class="pf-call-coin pf-face-mini">♛</span>Face<kbd>F</kbd></button>
          </div>
          <label class="pk-label" for="pf-stake">Mise</label>
          <div class="pk-stake">
            <input id="pf-stake" type="number" min="${RULES.minStake}" max="${RULES.maxStake}" step="1" inputmode="numeric" value="${stake}" data-stake>
            <button class="pk-mini" data-action="HALF" aria-label="Diviser la mise par deux">½</button>
            <button class="pk-mini" data-action="DOUBLE" aria-label="Doubler la mise">×2</button>
            <button class="pk-mini" data-action="MAX" aria-label="Miser le maximum">Max</button>
          </div>
          <div class="pf-presets">${STAKE_PRESETS.map((value) => `<button type="button" data-action="PRESET" data-value="${value}">${formatChips(value)}</button>`).join('')}</div>
          <p class="pf-gain" data-gain></p>
          <button class="btn primary pf-main" data-action="FLIP">Lancer la pièce<kbd>Espace</kbd></button>
          <button class="btn pf-ride" data-action="RIDE" hidden></button>
          ${refillButtonHtml('pileface', 'ghost', 'hidden')}
          <p class="pf-rules">Pièce équilibrée : une chance sur deux. Un bon pronostic paie ${multiplierText} la mise (${percent(coinflipHouseEdge(RULES))} pour la maison). Après un gain, le quitte ou double remet tout en jeu, jusqu'à ${RULES.maxChain} lancers d'affilée.</p>
          <p class="message pf-message" data-message aria-live="polite"></p>
        </aside>
        <section class="pf-stage">
          <div class="pf-arena">
            <div class="pf-toss" data-toss>
              <div class="pf-coin" data-coin>
                <div class="pf-side pf-face"><span class="pf-emblem">♛</span><span class="pf-word">FACE</span></div>
                <div class="pf-side pf-pile"><span class="pf-emblem">1</span><span class="pf-word">PILE</span></div>
              </div>
            </div>
            <div class="pf-shadow" data-shadow></div>
          </div>
        </section>
        <section class="pf-board">
          <div class="pf-stats" data-stats></div>
          <div class="pf-history-head"><span class="pk-label">Derniers lancers</span><span class="pf-run" data-run></span></div>
          <ol class="pf-history" data-history aria-label="Derniers lancers, du plus récent au plus ancien"></ol>
        </section>
      </div>
    </div>`;

  const ledgerEl = queryIn<HTMLElement>(root, '[data-ledger]');
  const bankrollEl = queryIn<HTMLElement>(root, '[data-bankroll]');
  const stakeEl = queryIn<HTMLInputElement>(root, '[data-stake]');
  const gainEl = queryIn<HTMLElement>(root, '[data-gain]');
  const flipEl = queryIn<HTMLButtonElement>(root, '[data-action="FLIP"]');
  const rideEl = queryIn<HTMLButtonElement>(root, '[data-action="RIDE"]');
  const rebuyEl = queryIn<HTMLButtonElement>(root, '[data-action="REBUY"]');
  const messageEl = queryIn<HTMLElement>(root, '[data-message]');
  const tossEl = queryIn<HTMLElement>(root, '[data-toss]');
  const coinEl = queryIn<HTMLElement>(root, '[data-coin]');
  const shadowEl = queryIn<HTMLElement>(root, '[data-shadow]');
  const statsEl = queryIn<HTMLElement>(root, '[data-stats]');
  const runEl = queryIn<HTMLElement>(root, '[data-run]');
  const historyEl = queryIn<HTMLOListElement>(root, '[data-history]');

  const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const safeStake = (): number => (Number.isSafeInteger(stake) && stake > 0 ? stake : 0);
  const payoutOf = (amount: number): number => Math.floor((amount * RULES.payout.numerator) / RULES.payout.denominator);

  function describe(result: CoinflipResult): [string, Tone] {
    const landed = `${result.side === 'FACE' ? '♛' : '①'} ${LABELS[result.side]} !`;
    const chain = result.chain > 1 ? ` · quitte ou double n° ${result.chain}` : '';
    if (result.won) return [`${landed} Gagné : ${formatChips(result.payout)} jetons (${formatSigned(result.net)})${chain}.`, 'win'];
    return [`${landed} Perdu : vous aviez parié ${LABELS[result.call]}, ${formatChips(result.stake)} jetons partent${chain}.`, 'loss'];
  }

  /** Fait tourner la pièce jusqu'au côté sorti, puis dévoile le résultat. */
  function animate(result: CoinflipResult): void {
    const duration = reducedMotion() ? REDUCED_FLIP_MS : FLIP_MS;
    const target = SIDE_ANGLE[result.side];
    const spins = reducedMotion() ? 1 : 5 + Math.floor(Math.random() * 3);
    // Au moins `spins` tours complets, puis l'angle juste pour finir sur le bon côté.
    const base = angle + spins * 360;
    angle = base + ((((target - base) % 360) + 360) % 360);
    coinEl.style.transitionDuration = `${duration}ms`;
    coinEl.style.transform = `rotateX(${angle}deg)`;
    for (const element of [tossEl, shadowEl]) {
      element.classList.remove('is-flying');
      void element.offsetWidth;
      element.style.animationDuration = `${duration}ms`;
      element.classList.add('is-flying');
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(land, duration);
  }

  function land(): void {
    if (flying === null) return;
    [message, tone] = describe(flying);
    flying = null;
    shownBankroll = state.player.bankroll;
    coinEl.classList.add('is-landed');
    render();
  }

  function play(command: CoinflipCommand): void {
    if (flying !== null) return;
    if (rigged) state = { ...state, upcoming: command.call };
    const result = controller.apply(state, command);
    if (!result.ok) {
      [message, tone] = [result.error.message, 'error'];
      render();
      return;
    }
    shownBankroll = state.player.bankroll - (command.type === 'FLIP' ? command.stake : (state.lastFlip?.payout ?? 0));
    state = result.value.state;
    const flipped = state.lastFlip;
    if (flipped === null) return;
    // Réglé tout de suite : quitter la page pendant que la pièce tourne ne change rien au résultat.
    recordResult('pileface', flipped.net);
    saveBalance('pileface', state.player.bankroll);
    flying = flipped;
    coinEl.classList.remove('is-landed');
    [message, tone] = [`La pièce tourne… vous avez parié ${LABELS[flipped.call]}.`, 'info'];
    animate(flipped);
    render();
  }

  function flip(): void {
    play({ type: 'FLIP', playerId: PLAYER, stake: chips(safeStake()), call });
  }

  function ride(): void {
    play({ type: 'RIDE', playerId: PLAYER, call });
  }

  function render(): void {
    const view = controller.project(state, PLAYER);
    const busy = flying !== null;
    const bankroll = busy ? shownBankroll : state.player.bankroll;

    saveBalance('pileface', state.player.bankroll);
    bankrollEl.textContent = formatChips(bankroll);
    const net = netOf(loadLedger().pileface);
    ledgerEl.textContent = formatSigned(net);
    ledgerEl.className = signClass(net);
    messageEl.textContent = message;
    messageEl.dataset['tone'] = tone;

    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-action="CALL"]')) {
      button.setAttribute('aria-pressed', String(button.dataset['side'] === call));
      button.disabled = busy;
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-action="PRESET"]')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset['value']) === stake));
      button.disabled = busy;
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-action="HALF"], [data-action="DOUBLE"], [data-action="MAX"]')) {
      button.disabled = busy;
    }
    stakeEl.disabled = busy;

    const canFlip = view.legalActions.actions.includes('FLIP');
    gainEl.innerHTML = `Gain si ${LABELS[call]} sort : <strong>${formatChips(payoutOf(safeStake()))} jetons</strong> <span>(${multiplierText})</span>`;
    flipEl.disabled = busy || !canFlip;

    const rideStake = busy ? null : view.legalActions.rideStake;
    rideEl.hidden = rideStake === null;
    if (rideStake !== null) {
      const chain = (state.lastFlip?.chain ?? 0) + 1;
      rideEl.innerHTML = `Quitte ou double sur ${LABELS[call]} : ${formatChips(rideStake)} → ${formatChips(payoutOf(rideStake))}<span class="pf-chain">${chain}/${RULES.maxChain}</span>`;
    }
    rebuyEl.hidden = busy || canFlip;
    syncRefillButton(rebuyEl, 'pileface');

    const { stats } = view;
    const pileShare = stats.flips === 0 ? 0.5 : stats.pile / stats.flips;
    statsEl.innerHTML = `
      <div class="pf-split" aria-label="Répartition Pile et Face">
        <span class="pf-split-pile" style="width: ${pileShare * 100}%">Pile ${stats.pile}</span>
        <span class="pf-split-face" style="width: ${(1 - pileShare) * 100}%">Face ${stats.face}</span>
      </div>
      <div class="pf-stat"><span>Lancers</span><strong>${formatChips(stats.flips)}</strong></div>
      <div class="pf-stat"><span>Réussite</span><strong>${stats.flips === 0 ? '—' : percent(stats.wins / stats.flips)}</strong></div>
      <div class="pf-stat"><span>Plus gros gain</span><strong>${stats.biggestWin > 0 ? `+${formatChips(stats.biggestWin)}` : '—'}</strong></div>
      <div class="pf-stat"><span>Meilleur quitte ou double</span><strong>${stats.bestChain > 1 ? `${stats.bestChain} d'affilée` : '—'}</strong></div>`;

    // Pendant le vol, le bandeau n'affiche pas encore le côté sorti.
    const history = busy ? view.history.slice(1) : view.history;
    historyEl.innerHTML = history
      .slice(0, HISTORY_SHOWN)
      .map((side, index) => `<li class="pf-dot pf-dot-${side.toLowerCase()} ${index === 0 ? 'is-latest' : ''}" title="${LABELS[side]}">${side === 'FACE' ? 'F' : 'P'}</li>`)
      .join('');
    const [latest] = history;
    let length = 0;
    while (latest !== undefined && history[length] === latest) length += 1;
    runEl.textContent = latest === undefined ? '' : `Série : ${length} × ${LABELS[latest]}`;
  }

  function setStake(value: number): void {
    stake = Math.max(RULES.minStake, Math.min(RULES.maxStake, Math.floor(value)));
    stakeEl.value = String(stake);
    render();
  }

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('button[data-action]');
    if (button === null || button.disabled) return;
    switch (button.dataset['action']) {
      case 'CALL':
        call = button.dataset['side'] === 'PILE' ? 'PILE' : 'FACE';
        render();
        break;
      case 'FLIP':
        flip();
        break;
      case 'RIDE':
        ride();
        break;
      case 'HALF':
        setStake(safeStake() / 2);
        break;
      case 'DOUBLE':
        setStake(safeStake() * 2);
        break;
      case 'MAX':
        setStake(Math.max(RULES.minStake, Math.min(RULES.maxStake, state.player.bankroll)));
        break;
      case 'PRESET':
        setStake(Number(button.dataset['value']));
        break;
      case 'REBUY':
        if (claimDailyRefill('pileface')) {
          state = { ...state, player: { ...state.player, bankroll: chips(state.player.bankroll + DAILY_REFILL) } };
          [message, tone] = [REFILL_DONE_MESSAGE, 'win'];
        } else {
          [message, tone] = [REFILL_USED_MESSAGE, 'error'];
        }
        render();
        break;
    }
  }

  function onInput(event: Event): void {
    if (event.target !== stakeEl) return;
    stake = Math.floor(Number(stakeEl.value));
    render();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement && event.key !== 'Enter') return;
    const key = event.key.toLowerCase();
    if (key === 'p' || key === 'f') {
      if (flying !== null) return;
      call = key === 'p' ? 'PILE' : 'FACE';
      render();
    } else if (key === ' ' || key === 'enter') {
      event.preventDefault();
      flip();
    } else if (key === 'd') {
      if (!rideEl.hidden) ride();
    }
  }

  setCheatTarget({
    games: ['pileface'],
    getBalance: () => state.player.bankroll,
    setBalance: (_game, amount) => {
      if (flying !== null) return 'Attendez que la pièce retombe.';
      state = { ...state, player: { ...state.player, bankroll: chips(Number(amount)) } };
      render();
      return null;
    },
    refresh: render,
    foresee: () =>
      rigged
        ? `Pièce truquée : elle tombera sur ${LABELS[call]}, votre côté.`
        : `La pièce est déjà décidée : le prochain lancer tombera sur ${LABELS[state.upcoming]}.`,
    runCode: (code) => {
      if (code !== 'doubleface') return null;
      rigged = !rigged;
      return rigged
        ? 'DOUBLEFACE : pièce truquée, deux côtés identiques. Elle tombe toujours sur votre pari.'
        : 'La pièce redevient honnête.';
    },
  });

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  window.addEventListener('keydown', onKey);
  coinEl.style.transform = `rotateX(${angle}deg)`;
  render();

  return () => {
    window.clearTimeout(timer);
    saveBalance('pileface', state.player.bankroll);
    setCheatTarget(null);
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
    window.removeEventListener('keydown', onKey);
  };
}
