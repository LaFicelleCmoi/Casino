import { CryptoRandomSource, chips, playerId, type PlayerId, type Suit } from '../src/core/index.js';
import {
  HiloController,
  STANDARD_HILO_RULES,
  formatHiloMultiplier,
  rankLabel,
  type HiloCard,
  type HiloChoice,
  type HiloCommand,
  type HiloDirection,
  type HiloEvent,
  type HiloState,
} from '../src/hilo/index.js';
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
} from './ui.js';

type Tone = 'info' | 'win' | 'loss' | 'error';

const PLAYER: PlayerId = playerId('vous');
const RULES = STANDARD_HILO_RULES;
const SUIT_SYMBOLS: Readonly<Record<Suit, string>> = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };
const ACTION_MARKS = { HIGHER: '▲', LOWER: '▼', JOKER: '🃏' } as const;
const HISTORY_SIZE = 14;

const percent = (chance: number): string => `${Math.round(chance * 100)} %`;
const cardName = (card: HiloCard): string => `${rankLabel(card.rank)}${SUIT_SYMBOLS[card.suit]}`;

function cardHtml(card: HiloCard, classes = ''): string {
  const red = card.suit === 'hearts' || card.suit === 'diamonds';
  const rank = rankLabel(card.rank);
  const suit = SUIT_SYMBOLS[card.suit];
  return (
    `<div class="card${red ? ' red' : ''}${classes ? ` ${classes}` : ''}" aria-label="${rank} ${suit}">` +
    `<span class="corner">${rank}<br>${suit}</span><span class="pip">${suit}</span><span class="corner flip">${rank}<br>${suit}</span></div>`
  );
}

export function mountHilo(root: HTMLElement): () => void {
  const controller = new HiloController(new CryptoRandomSource());
  let state: HiloState = expectOk(controller.createSession(PLAYER, startingBalance('hilo')));
  let stake = 10;
  let message = 'Misez, puis devinez si la carte suivante sera plus haute ou plus basse.';
  let tone: Tone = 'info';
  /** Code NOSTRADAMUS : la carte suivante s'affiche discrètement. */
  let oracle = false;
  let shownKey = '';

  root.innerHTML = `
    <div class="game hl-game">
      <header class="topbar">
        <a class="back" href="#/">← Lobby</a>
        <h1>Hi-Lo</h1>
        <div class="topbar-stats">
          <div class="bankroll">Bilan <strong data-ledger></strong></div>
          <div class="bankroll">Solde <strong data-bankroll></strong></div>
        </div>
      </header>
      <div class="hl-layout">
        <section class="felt hl-table">
          <p class="rules-strip">Plus haut ou égal · plus bas ou égal · l’As est la plus basse, le Roi la plus haute</p>
          <div class="hl-cards">
            <div class="hl-deck" aria-hidden="true"><div class="card back"></div></div>
            <div class="hl-current" data-current></div>
          </div>
          <p class="message" data-message aria-live="polite"></p>
          <div class="hl-streak" data-streak></div>
          <ol class="hl-history" data-history aria-label="Cartes précédentes"></ol>
        </section>
        <aside class="hl-controls" data-controls></aside>
      </div>
      <aside class="hl-oracle" data-oracle hidden></aside>
    </div>`;

  const ledgerEl = queryIn<HTMLElement>(root, '[data-ledger]');
  const bankrollEl = queryIn<HTMLElement>(root, '[data-bankroll]');
  const currentEl = queryIn<HTMLElement>(root, '[data-current]');
  const messageEl = queryIn<HTMLElement>(root, '[data-message]');
  const streakEl = queryIn<HTMLElement>(root, '[data-streak]');
  const historyEl = queryIn<HTMLElement>(root, '[data-history]');
  const controlsEl = queryIn<HTMLElement>(root, '[data-controls]');
  const oracleEl = queryIn<HTMLElement>(root, '[data-oracle]');

  const safeStake = (): number => (Number.isSafeInteger(stake) && stake > 0 ? stake : 0);

  function apply(command: HiloCommand): readonly HiloEvent[] | null {
    const before = state.phase;
    const result = controller.apply(state, command);
    if (!result.ok) {
      [message, tone] = [result.error.message, 'error'];
      return null;
    }
    state = result.value.state;
    const current = state;
    if (before === 'PLAYING' && current.phase === 'IDLE' && current.lastRound !== null) {
      const round = current.lastRound;
      recordResult('hilo', round.net);
      [message, tone] =
        round.outcome === 'LOST'
          ? [`Raté : ${cardName(round.lastCard)}. Vous perdez ${formatChips(round.stake)} jetons.`, 'loss']
          : [`Encaissé à ×${formatHiloMultiplier(round.multiplier)} après ${round.streak} bon${round.streak > 1 ? 's' : ''} pronostic${round.streak > 1 ? 's' : ''} : ${formatChips(round.payout)} jetons.`, 'win'];
    }
    return result.value.events;
  }

  function guess(direction: HiloDirection): void {
    const events = apply({ type: 'GUESS', playerId: PLAYER, direction });
    const turned = events?.find((event) => event.type === 'CARD_TURNED');
    const current = state;
    if (turned?.type === 'CARD_TURNED' && turned.won && current.phase === 'PLAYING') {
      [message, tone] = [`Gagné : ${cardName(turned.card)} ! Série de ${current.round.streak}, multiplicateur ×${formatHiloMultiplier(current.round.multiplier)}.`, 'win'];
    }
    render();
  }

  function controlsHtml(): string {
    const view = controller.project(state, PLAYER);
    const round = view.round;
    if (round === null) {
      const rebuy = state.player.bankroll < RULES.minStake ? refillButtonHtml('hilo', 'ghost') : '';
      return `
        <label class="pk-label" for="hl-stake">Mise</label>
        <div class="pk-stake">
          <input id="hl-stake" type="number" min="1" step="1" inputmode="numeric" value="${stake}" data-stake>
          <button class="pk-mini" data-action="HALF" aria-label="Diviser la mise par deux">½</button>
          <button class="pk-mini" data-action="DOUBLE" aria-label="Doubler la mise">×2</button>
        </div>
        <button class="btn primary" data-action="START">Parier <kbd>↵</kbd></button>
        ${rebuy}
        <ul class="hl-rules">
          <li>Chaque bon pronostic multiplie la série.</li>
          <li>Une carte de même valeur compte comme gagnée.</li>
          <li>${RULES.jokersPerRound} jokers par partie pour passer une carte.</li>
          <li>Encaissez quand vous voulez.</li>
        </ul>`;
    }
    const choice = (direction: HiloDirection, info: HiloChoice, label: string): string =>
      `<button class="btn hl-choice hl-${direction.toLowerCase()}" data-action="${direction}" ${info.allowed ? '' : 'disabled'}>` +
      `<span>${ACTION_MARKS[direction]} ${label}</span><small>${info.allowed ? `×${formatHiloMultiplier(info.multiplier)} · ${percent(info.chance)}` : 'Gagné d’avance'}</small></button>`;
    return `
      ${choice('HIGHER', round.higher, 'Plus haut ou égal')}
      ${choice('LOWER', round.lower, 'Plus bas ou égal')}
      <button class="btn" data-action="JOKER" ${round.jokersLeft > 0 ? '' : 'disabled'}>🃏 Joker : passer la carte (${round.jokersLeft})</button>
      <button class="btn primary" data-action="CASH" ${round.streak > 0 ? '' : 'disabled'}>Encaisser ${formatChips(round.cashOutValue)} jetons <kbd>↵</kbd></button>
      <p class="hl-hint">Flèches ↑ ↓ pour parier · J pour le joker</p>`;
  }

  function render(): void {
    const current = state;
    saveBalance('hilo', current.player.bankroll);
    bankrollEl.textContent = formatChips(current.player.bankroll);
    const net = netOf(loadLedger().hilo);
    ledgerEl.textContent = formatSigned(net);
    ledgerEl.className = signClass(net);
    messageEl.textContent = message;
    messageEl.dataset['tone'] = tone;

    const round = current.phase === 'PLAYING' ? current.round : null;
    const last = current.phase === 'IDLE' ? current.lastRound : null;
    const card = round?.current ?? last?.lastCard ?? null;
    const key = card === null ? 'dos' : `${current.roundsPlayed}-${round?.steps.length ?? 'fin'}-${card.rank}${card.suit}`;
    const status = last === null ? '' : last.outcome === 'LOST' ? 'is-lost' : 'is-won';
    currentEl.innerHTML = card === null ? '<div class="card back"></div>' : cardHtml(card, `${status}${key !== shownKey ? ' deal' : ''}`);
    shownKey = key;

    if (round !== null) {
      streakEl.innerHTML = `Série <strong>${round.streak}</strong> · multiplicateur <strong>×${formatHiloMultiplier(round.multiplier)}</strong> · jokers <strong>${round.jokersLeft}</strong>`;
    } else if (last !== null) {
      streakEl.innerHTML = `Dernière partie : série de <strong>${last.streak}</strong> · <strong class="${signClass(last.net)}">${formatSigned(last.net)}</strong>`;
    } else {
      streakEl.textContent = '';
    }

    const steps = round?.steps ?? last?.steps ?? [];
    historyEl.innerHTML = steps
      .slice(-HISTORY_SIZE)
      .map((step) => {
        const verdict = step.action === 'JOKER' ? '' : step.won ? 'win' : 'loss';
        return `<li>${cardHtml(step.to)}<span class="hl-mark ${verdict}">${ACTION_MARKS[step.action]}${verdict === 'win' ? '✓' : verdict === 'loss' ? '✗' : ''}</span></li>`;
      })
      .join('');

    controlsEl.innerHTML = controlsHtml();

    if (oracle && round !== null) {
      oracleEl.hidden = false;
      oracleEl.innerHTML = `<span aria-hidden="true">🔮</span>${cardHtml(round.next)}<span>${cardName(round.next)}</span>`;
    } else {
      oracleEl.hidden = true;
    }
  }

  function startRound(): void {
    if (apply({ type: 'START_ROUND', playerId: PLAYER, stake: chips(safeStake()) }) !== null) {
      [message, tone] = ['Plus haut ou plus bas ?', 'info'];
    }
    render();
  }

  function cashOut(): void {
    apply({ type: 'CASH_OUT', playerId: PLAYER });
    render();
  }

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('button[data-action]');
    if (button === null || button.disabled) return;
    switch (button.dataset['action']) {
      case 'START':
        startRound();
        break;
      case 'HIGHER':
      case 'LOWER':
        guess(button.dataset['action']);
        break;
      case 'JOKER':
        if (apply({ type: 'JOKER', playerId: PLAYER }) !== null) [message, tone] = ['🃏 Joker : la carte est passée sans risque.', 'info'];
        render();
        break;
      case 'CASH':
        cashOut();
        break;
      case 'HALF':
      case 'DOUBLE': {
        stake = Math.max(RULES.minStake, Math.min(RULES.maxStake, Math.floor(button.dataset['action'] === 'HALF' ? safeStake() / 2 : safeStake() * 2)));
        const input = controlsEl.querySelector<HTMLInputElement>('[data-stake]');
        if (input !== null) input.value = String(stake);
        break;
      }
      case 'REBUY':
        if (claimDailyRefill('hilo')) {
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
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-stake]')) stake = Math.floor(Number(event.target.value));
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement && event.key !== 'Enter') return;
    const current = state;
    const shortcuts: Readonly<Record<string, () => void>> =
      current.phase === 'PLAYING'
        ? {
            ArrowUp: () => guess('HIGHER'),
            ArrowDown: () => guess('LOWER'),
            j: () => {
              if (apply({ type: 'JOKER', playerId: PLAYER }) !== null) [message, tone] = ['🃏 Joker : la carte est passée sans risque.', 'info'];
              render();
            },
            Enter: () => {
              if (current.round.streak > 0) cashOut();
            },
          }
        : { Enter: startRound };
    const handler = shortcuts[event.key] ?? shortcuts[event.key.toLowerCase()];
    if (handler !== undefined) {
      event.preventDefault();
      handler();
    }
  }

  setCheatTarget({
    games: ['hilo'],
    getBalance: () => state.player.bankroll,
    setBalance: (_game, amount) => {
      state = { ...state, player: { ...state.player, bankroll: chips(amount) } };
      render();
      return null;
    },
    refresh: render,
    foresee: () => {
      const current = state;
      return current.phase === 'PLAYING' ? `La carte suivante sera ${cardName(current.round.next)}.` : 'Misez d’abord : l’avenir ne se lit qu’en pleine partie.';
    },
    runCode: (code) => {
      if (code !== 'nostradamus') return null;
      oracle = !oracle;
      render();
      return oracle ? 'NOSTRADAMUS : la carte suivante vous est soufflée discrètement, en bas à gauche de l’écran.' : 'Nostradamus se tait.';
    },
  });

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  window.addEventListener('keydown', onKey);
  render();

  return () => {
    const current = state;
    // Quitter en pleine série encaisse ; avant le premier bon pronostic, la mise est perdue.
    if (current.phase === 'PLAYING') {
      if (current.round.streak > 0) apply({ type: 'CASH_OUT', playerId: PLAYER });
      else recordResult('hilo', -current.round.stake);
    }
    saveBalance('hilo', state.player.bankroll);
    setCheatTarget(null);
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
    window.removeEventListener('keydown', onKey);
  };
}
