import { CryptoRandomSource, chips, type Card, type SeatIndex } from '../src/core/index.js';
import {
  HoldemController,
  isHandInProgress,
  type HoldemTableView,
  type PokerBettingActionType,
  type PokerSeat,
  type PokerSeatView,
  type Street,
} from '../src/holdem/index.js';
import { setCheatTarget, xrayEnabled } from './cheat-console.js';
import {
  CATEGORY_LABELS,
  HOLDEM_HOST,
  HOLDEM_TABLE_RULES,
  HoldemTable,
  STREET_LABELS,
  isSimpleBettingAction,
  type HoldemSnapshot,
  type HoldemTableCommand,
} from './holdem-table.js';
import { DAILY_REFILL, claimDailyRefill, loadLedger, netOf, recordResult, saveBalance, startingBalance } from './money-ledger.js';
import { MAX_TABLE_PLAYERS } from './net/peer-link.js';
import { loadPlayerName, savePlayerName } from './net/player-name.js';
import { joinSharedTable, localClient, shareTable, type ShareSession, type TableClient } from './net/shared-table.js';
import { GUEST_CHEAT_LOCK, joinPanelHtml, shareBarHtml } from './net/table-ui.js';
import {
  DealAnimator,
  REFILL_DONE_MESSAGE,
  REFILL_USED_MESSAGE,
  cardText,
  escapeHtml,
  formatChips,
  formatSigned,
  queryIn,
  refillButtonHtml,
  setHtml,
  signClass,
} from './ui.js';

type Client = TableClient<HoldemSnapshot, HoldemTableCommand>;

const ACTION_BADGES: Record<PokerBettingActionType, string> = {
  FOLD: 'Couché',
  CHECK: 'Check',
  CALL: 'Suit',
  BET: 'Mise',
  RAISE: 'Relance',
  ALL_IN: 'Tapis',
};

const UPCOMING_STREETS: Readonly<Record<Street, readonly Exclude<Street, 'PREFLOP'>[]>> = {
  PREFLOP: ['FLOP', 'TURN', 'RIVER'],
  FLOP: ['TURN', 'RIVER'],
  TURN: ['RIVER'],
  RIVER: [],
};

function potTotal(view: HoldemTableView): number {
  return (
    view.pots.reduce((sum, pot) => sum + pot.amount, 0) + view.seats.reduce((sum, seat) => sum + (seat?.streetBet ?? 0), 0)
  );
}

const seatOfViewer = (view: HoldemTableView): PokerSeatView | null =>
  view.viewerSeat === null ? null : (view.seats[view.viewerSeat] ?? null);

const nameOf = (view: HoldemTableView, seatIndex: SeatIndex): string =>
  view.seats[seatIndex]?.player.displayName ?? `Siège ${seatIndex + 1}`;

/** Joue sur la table locale (tableId null) ou rejoint la table partagée désignée par le lien. */
export function mountHoldem(root: HTMLElement, tableId: string | null = null): () => void {
  const rng = new CryptoRandomSource();
  const engine = new HoldemController(rng);
  const animator = new DealAnimator();
  const host = tableId === null ? new HoldemTable(engine, rng, loadPlayerName(), startingBalance('holdem')) : null;
  let client: Client | null = host === null ? null : localClient(host, HOLDEM_HOST);
  let share: ShareSession | null = null;
  let opening = false;
  let connecting = false;
  let joinError: string | null = null;
  let unsubscribe: () => void = () => {};
  let raiseTo = 0;
  let localMessage: string | null = null;
  let last: HoldemSnapshot | null = null;
  let lastBarHtml = '';
  let disposed = false;
  /** Main en cours pour le bilan : son numéro et le tapis de départ (mises forcées comprises). */
  let tracked: { readonly hand: number; readonly start: number } | null = null;
  let lastRecordedHand = 0;

  root.innerHTML = `
    <div class="game">
      <header class="topbar">
        <a class="back" href="#/">← Lobby</a>
        <h1>Texas Hold'em</h1>
        <div class="topbar-stats">
          <div class="bankroll">Bilan <strong data-ledger></strong></div>
          <div class="bankroll">Tapis <strong data-stack></strong></div>
        </div>
      </header>
      <div class="share-bar" data-share></div>
      <div class="holdem-layout">
        <section class="felt poker-felt">
          <div class="poker-table">
            <div class="board-zone">
              <div class="pot" data-pot></div>
              <div class="card-row board" data-board></div>
              <p class="message" data-message aria-live="polite"></p>
            </div>
            <div data-seats></div>
            <div class="poker-join" data-join></div>
          </div>
        </section>
        <aside class="side-panel">
          <h2>Déroulement</h2>
          <ol class="log" data-log></ol>
        </aside>
      </div>
      <nav class="controls" data-controls></nav>
    </div>`;

  const shareEl = queryIn<HTMLElement>(root, '[data-share]');
  const stackEl = queryIn<HTMLElement>(root, '[data-stack]');
  const ledgerEl = queryIn<HTMLElement>(root, '[data-ledger]');
  const potEl = queryIn<HTMLElement>(root, '[data-pot]');
  const boardEl = queryIn<HTMLElement>(root, '[data-board]');
  const messageEl = queryIn<HTMLElement>(root, '[data-message]');
  const seatsEl = queryIn<HTMLElement>(root, '[data-seats]');
  const joinEl = queryIn<HTMLElement>(root, '[data-join]');
  const logEl = queryIn<HTMLElement>(root, '[data-log]');
  const controlsEl = queryIn<HTMLElement>(root, '[data-controls]');

  const hostSeat = (): PokerSeat | null => host?.state.seats.find((seat) => seat?.player.id === HOLDEM_HOST) ?? null;

  function send(command: HoldemTableCommand): void {
    localMessage = null;
    client?.send(command);
  }

  function renderLedger(): void {
    const net = netOf(loadLedger().holdem);
    ledgerEl.textContent = formatSigned(net);
    ledgerEl.className = signClass(net);
  }

  function renderShareBar(snapshot: HoldemSnapshot | null): void {
    shareEl.hidden = snapshot === null;
    if (snapshot === null) return;
    const html = shareBarHtml({
      mode: host === null ? 'guest' : share !== null ? 'host' : opening ? 'opening' : 'solo',
      name: loadPlayerName(),
      link: share?.link ?? null,
      players: snapshot.players,
    });
    // Ne reconstruit le bandeau que s'il change : sinon le pseudo en cours de saisie perdrait le focus.
    if (html !== lastBarHtml) {
      shareEl.innerHTML = html;
      lastBarHtml = html;
    }
  }

  /** Suit le tapis du joueur sur chaque main jouée et enregistre le résultat à l'abattage, une seule fois. */
  function track(view: HoldemTableView): void {
    const seat = seatOfViewer(view);
    const inHand = view.phase !== 'WAITING' && view.phase !== 'HAND_COMPLETE';
    if (inHand && seat !== null && seat.holeCards !== null && view.handNumber > lastRecordedHand && tracked?.hand !== view.handNumber) {
      tracked = { hand: view.handNumber, start: seat.stack + seat.totalCommitted };
    }
    if (view.phase === 'HAND_COMPLETE' && tracked !== null && tracked.hand === view.handNumber) {
      recordResult('holdem', (seat?.stack ?? 0) - tracked.start);
      lastRecordedHand = view.handNumber;
      tracked = null;
    }
  }

  /** Carte réelle derrière une carte face cachée d'un adversaire : rayons X, sur la table du créateur uniquement. */
  const hiddenCard = (seatIndex: number, cardIndex: number): Card | null =>
    host !== null && xrayEnabled() ? (host.state.seats[seatIndex]?.holeCards?.[cardIndex] ?? null) : null;

  function potText(view: HoldemTableView): string {
    if (view.outcome !== null) {
      const won = new Map<SeatIndex, number>();
      for (const award of view.outcome.awards) {
        for (const share of award.shares) won.set(share.seatIndex, (won.get(share.seatIndex) ?? 0) + share.amount);
      }
      return [...won].map(([seat, amount]) => `${nameOf(view, seat)} +${formatChips(amount)}`).join(' · ');
    }
    return view.phase === 'WAITING' ? '' : `Pot ${formatChips(potTotal(view))}`;
  }

  function turnText(snapshot: HoldemSnapshot): string {
    const { view } = snapshot;
    if (view.outcome !== null) {
      const hand = view.outcome.awards[0]?.winningHand;
      return hand ? `Abattage : ${CATEGORY_LABELS[hand.category]} gagnant.` : 'Tout le monde s’est couché.';
    }
    if (view.viewerSeat === null) {
      return host === null ? 'Vous serez assis à la prochaine main.' : "Vous n'avez plus de jetons.";
    }
    if (view.toAct === null) return '';
    return view.toAct === view.viewerSeat ? 'À vous de parler.' : `${nameOf(view, view.toAct)} réfléchit…`;
  }

  function renderSeat(view: HoldemTableView, seat: PokerSeatView | null, index: number): string {
    if (seat === null) return '';
    const { outcome } = view;
    const winners = new Set(outcome?.awards.flatMap((award) => award.shares.map((share) => share.seatIndex)) ?? []);
    const shown = outcome?.kind === 'SHOWDOWN' ? outcome.showdown.find((entry) => entry.seatIndex === index) : undefined;
    const position = (index - (view.viewerSeat ?? 0) + MAX_TABLE_PLAYERS) % MAX_TABLE_PLAYERS;

    const cards =
      seat.holeCards === null
        ? ''
        : seat.holeCards
            .map((card, i) =>
              animator.card(
                `h${view.handNumber}-${index}-${i}-${card.faceUp ? 'up' : 'down'}`,
                card.faceUp ? card.card : hiddenCard(index, i),
                true,
                !card.faceUp && host !== null && xrayEnabled(),
              ),
            )
            .join('');

    let badge = '';
    if (shown !== undefined) badge = CATEGORY_LABELS[shown.hand.category];
    else if (seat.status === 'SITTING_OUT') badge = seat.stack === 0 ? 'Éliminé' : 'Absent';
    else if (seat.status === 'ALL_IN') badge = 'Tapis';
    else if (seat.lastAction !== null && view.phase !== 'HAND_COMPLETE') badge = ACTION_BADGES[seat.lastAction];

    const classes = [
      'seat',
      `pos-${position}`,
      view.toAct === index ? 'acting' : '',
      seat.status === 'FOLDED' ? 'folded' : '',
      winners.has(index) ? 'winner' : '',
      index === view.viewerSeat ? 'hero' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const bet =
      seat.streetBet > 0 && view.phase !== 'HAND_COMPLETE' ? `<span class="bet-chip">${formatChips(seat.streetBet)}</span>` : '';

    return `
      <div class="${classes}">
        <div class="seat-cards">${cards}</div>
        <div class="seat-plate">
          ${view.buttonSeat === index ? '<span class="dealer-button" title="Bouton">D</span>' : ''}
          <span class="seat-name">${escapeHtml(seat.player.displayName)}</span>
          <span class="seat-stack">${formatChips(seat.stack)}</span>
          ${badge ? `<span class="seat-badge">${badge}</span>` : ''}
        </div>
        ${bet}
      </div>`;
  }

  function renderControls(snapshot: HoldemSnapshot): string {
    const { view } = snapshot;
    const button = (action: string, label: string, variant = '', data = ''): string =>
      `<button class="btn ${variant}" data-action="${action}" ${data}>${label}</button>`;

    if (view.phase === 'WAITING' || view.phase === 'HAND_COMPLETE') {
      const seat = seatOfViewer(view);
      const queued = seat === null && host === null && startingBalance('holdem') >= view.rules.bigBlind;
      // Sans de quoi payer la grosse blinde, le joueur ne peut plus rejouer : place à la recharge du jour.
      const broke = !queued && (seat?.stack ?? 0) < view.rules.bigBlind;
      return broke
        ? `<p class="waiting">Vous n'avez plus de jetons.</p>${refillButtonHtml('holdem')}`
        : button('NEXT_HAND', 'Main suivante <kbd>↵</kbd>', 'primary');
    }

    const legal = view.legalActions;
    if (legal === null) {
      return `<p class="waiting">${view.toAct === null ? '' : `${escapeHtml(nameOf(view, view.toAct))} réfléchit…`}</p>`;
    }

    const parts = [button('FOLD', 'Se coucher <kbd>F</kbd>', 'ghost')];
    parts.push(
      legal.canCheck
        ? button('CHECK', 'Checker <kbd>C</kbd>')
        : button('CALL', `Suivre ${formatChips(legal.callAmount ?? 0)} <kbd>C</kbd>`, 'primary'),
    );

    const range = legal.raise ?? legal.bet;
    if (range !== null) {
      if (raiseTo < range.min || raiseTo > range.max) raiseTo = range.min;
      const pot = potTotal(view);
      const preset = (label: string, fraction: number): string => {
        const value = Math.min(range.max, Math.max(range.min, range.min + Math.round(pot * fraction)));
        return button('PRESET', label, 'ghost', `data-value="${value}"`);
      };
      const isRaise = legal.raise !== null;
      parts.push(`
        <div class="raise-box">
          <input type="range" data-raise min="${range.min}" max="${range.max}" step="1" value="${raiseTo}" aria-label="Montant de la mise">
          <div class="presets">${preset('½ pot', 0.5)}${preset('Pot', 1)}</div>
          ${button(isRaise ? 'RAISE' : 'BET', `${isRaise ? 'Relancer à' : 'Miser'} <strong data-raise-label>${formatChips(raiseTo)}</strong>`, 'primary')}
        </div>`);
    }
    if (legal.allInAmount !== null) parts.push(button('ALL_IN', `Tapis ${formatChips(legal.allInAmount)}`, 'danger'));
    return parts.join('');
  }

  function renderJoin(): void {
    const balance = startingBalance('holdem');
    stackEl.textContent = formatChips(balance);
    potEl.textContent = '';
    setHtml(boardEl, Array.from({ length: 5 }, () => '<div class="card-slot"></div>').join(''));
    messageEl.textContent = '';
    setHtml(seatsEl, '');
    setHtml(logEl, '');
    setHtml(controlsEl, '');
    setHtml(
      joinEl,
      joinPanelHtml({
        game: 'holdem',
        gameLabel: "Texas Hold'em",
        name: loadPlayerName(),
        balance,
        minimum: HOLDEM_TABLE_RULES.minBuyIn,
        connecting,
        error: joinError,
      }),
    );
  }

  function render(): void {
    if (disposed) return;
    const snapshot = client?.snapshot() ?? null;
    renderShareBar(snapshot);
    renderLedger();
    if (snapshot === null) {
      renderJoin();
      return;
    }
    last = snapshot;
    setHtml(joinEl, '');
    const { view } = snapshot;
    const mySeat = seatOfViewer(view);
    animator.beginFrame();

    track(view);
    renderLedger();
    if (mySeat !== null) saveBalance('holdem', mySeat.stack);
    stackEl.textContent = formatChips(mySeat?.stack ?? startingBalance('holdem'));

    setHtml(
      boardEl,
      Array.from({ length: 5 }, (_, i) => {
        const card = view.board[i];
        return card === undefined ? '<div class="card-slot"></div>' : animator.card(`b${view.handNumber}-${i}`, card);
      }).join(''),
    );
    potEl.textContent = potText(view);

    const closed = client?.isClosed() ?? false;
    const notice = closed ? 'Le créateur a quitté : la table est fermée.' : (snapshot.notice ?? localMessage);
    messageEl.textContent = notice ?? turnText(snapshot);
    messageEl.dataset['tone'] = notice === null ? 'info' : closed || snapshot.notice !== null ? 'error' : 'win';
    setHtml(seatsEl, view.seats.map((seat, index) => renderSeat(view, seat, index)).join(''));
    const waiting = snapshot.waiting.length === 0 ? [] : [`En attente de la prochaine main : ${snapshot.waiting.join(', ')}`];
    setHtml(logEl, [...snapshot.log, ...waiting].map((line) => `<li>${escapeHtml(line)}</li>`).join(''));
    logEl.scrollTop = logEl.scrollHeight;
    setHtml(controlsEl, closed ? '<a class="btn primary" href="#/holdem">Jouer seul</a>' : renderControls(snapshot));
  }

  async function invite(): Promise<void> {
    if (host === null || share !== null || opening) return;
    opening = true;
    render();
    try {
      const session = await shareTable('holdem', host, render);
      if (disposed) {
        session.close();
        return;
      }
      share = session;
      localMessage = 'Table ouverte : copiez le lien et envoyez-le à vos amis. Les bots leur cèdent leur siège.';
    } catch (error) {
      localMessage = error instanceof Error ? error.message : String(error);
    } finally {
      opening = false;
      render();
    }
  }

  async function join(): Promise<void> {
    if (tableId === null || connecting || client !== null) return;
    connecting = true;
    joinError = null;
    render();
    try {
      const joined = await joinSharedTable<HoldemSnapshot, HoldemTableCommand>('holdem', tableId, loadPlayerName(), startingBalance('holdem'));
      if (disposed) {
        joined.close();
        return;
      }
      client = joined;
      unsubscribe = joined.subscribe(render);
    } catch (error) {
      joinError = error instanceof Error ? error.message : String(error);
    } finally {
      connecting = false;
      render();
    }
  }

  function copyLink(): void {
    if (share === null) return;
    shareEl.querySelector<HTMLInputElement>('[data-share-link]')?.select();
    navigator.clipboard.writeText(share.link).then(
      () => {
        localMessage = 'Lien copié : il ne reste qu’à l’envoyer.';
        render();
      },
      () => {
        localMessage = 'Copie impossible : sélectionnez le lien et copiez-le à la main.';
        render();
      },
    );
  }

  function refill(): void {
    if (!claimDailyRefill('holdem')) {
      localMessage = REFILL_USED_MESSAGE;
      render();
      return;
    }
    const seat = last === null ? null : seatOfViewer(last.view);
    const bankroll = (seat === null ? startingBalance('holdem') : seat.stack) + DAILY_REFILL;
    saveBalance('holdem', bankroll);
    client?.send({ type: 'REBUY', bankroll });
    localMessage = REFILL_DONE_MESSAGE;
    render();
  }

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('button[data-action]');
    if (button === null || button.disabled) return;
    const action = button.dataset['action'] ?? '';
    switch (action) {
      case 'NEXT_HAND':
        send({ type: 'NEXT_HAND' });
        break;
      case 'REBUY':
        refill();
        break;
      case 'BET':
        send({ type: 'BET', amount: raiseTo });
        break;
      case 'RAISE':
        send({ type: 'RAISE', raiseTo });
        break;
      case 'PRESET':
        raiseTo = Number(button.dataset['value']);
        render();
        break;
      case 'INVITE':
        void invite();
        break;
      case 'COPY_LINK':
        copyLink();
        break;
      case 'JOIN':
        void join();
        break;
      default:
        if (isSimpleBettingAction(action)) send({ type: action });
    }
  }

  function onInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement) || !event.target.matches('[data-raise]')) return;
    raiseTo = Number(event.target.value);
    const label = root.querySelector('[data-raise-label]');
    if (label !== null) label.textContent = formatChips(raiseTo);
  }

  function onChange(event: Event): void {
    if (!(event.target instanceof HTMLInputElement) || !event.target.matches('[data-player-name]')) return;
    const name = savePlayerName(event.target.value);
    event.target.value = name;
    client?.send({ type: 'RENAME', name });
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement) return;
    const shortcuts: Readonly<Record<string, string>> = {
      ENTER: '[data-action="NEXT_HAND"]',
      F: '[data-action="FOLD"]',
      C: '[data-action="CHECK"], [data-action="CALL"]',
    };
    const selector = shortcuts[event.key.toUpperCase()];
    const button = selector === undefined ? null : controlsEl.querySelector<HTMLButtonElement>(selector);
    if (button !== null && !button.disabled) {
      event.preventDefault();
      button.click();
    }
  }

  /** Cartes communes à venir, en sautant la carte brûlée avant chaque street. */
  function foresee(): string {
    if (host === null) return GUEST_CHEAT_LOCK;
    const current = host.state;
    if (!isHandInProgress(current)) return 'Aucune main en cours : le paquet sera mélangé à la prochaine donne.';
    const streets = UPCOMING_STREETS[current.phase];
    if (streets.length === 0) return 'Toutes les cartes communes sont déjà sur la table.';
    let index = current.deck.nextIndex;
    return streets
      .map((street) => {
        const count = street === 'FLOP' ? 3 : 1;
        const drawn = current.deck.cards.slice(index + 1, index + 1 + count);
        index += 1 + count;
        return `${STREET_LABELS[street]} : ${drawn.map(cardText).join(' ')}`;
      })
      .join(' · ');
  }

  if (host !== null) {
    const table = host;
    setCheatTarget({
      games: ['holdem'],
      getBalance: () => hostSeat()?.stack ?? 0,
      setBalance: (_game, amount) => {
        const value = Number(amount);
        const seat = hostSeat();
        if (seat === null) {
          // Créateur ruiné, donc debout (aucune main ne tourne) : le nouveau tapis le rassoit.
          if (value < HOLDEM_TABLE_RULES.minBuyIn) return `Il faut au moins ${formatChips(HOLDEM_TABLE_RULES.minBuyIn)} jetons pour s'asseoir.`;
          table.command(HOLDEM_HOST, { type: 'REBUY', bankroll: value });
          return null;
        }
        if (isHandInProgress(table.state)) return 'Main en cours : le tapis se modifie entre deux mains.';
        // Un joueur ruiné est mis à l'écart par le moteur : on le rassoit s'il retrouve des jetons.
        const status = seat.status === 'SITTING_OUT' && value > 0 ? 'IN_HAND' : seat.status;
        const credited: PokerSeat = { ...seat, stack: chips(value), status };
        table.replaceState({ ...table.state, seats: table.state.seats.map((current) => (current === seat ? credited : current)) });
        return null;
      },
      refresh: render,
      foresee,
    });
  } else {
    setCheatTarget({ games: [], getBalance: () => 0, setBalance: () => GUEST_CHEAT_LOCK, refresh: render, locked: GUEST_CHEAT_LOCK });
  }

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  window.addEventListener('keydown', onKey);
  if (client !== null) {
    unsubscribe = client.subscribe(render);
    client.send({ type: 'NEXT_HAND' });
  }
  render();

  return () => {
    disposed = true;
    // Quitter en pleine main abandonne les jetons déjà engagés.
    if (tracked !== null && last !== null && !(client?.isClosed() ?? false)) {
      const seat = seatOfViewer(last.view);
      if (last.view.handNumber === tracked.hand && last.view.phase !== 'HAND_COMPLETE') recordResult('holdem', (seat?.stack ?? 0) - tracked.start);
    }
    unsubscribe();
    share?.close();
    client?.close();
    host?.dispose();
    setCheatTarget(null);
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onChange);
    window.removeEventListener('keydown', onKey);
  };
}
