import { CryptoRandomSource, chips, type Card } from '../src/core/index.js';
import {
  BlackjackController,
  dealerShouldHit,
  scoreCards,
  scoreHand,
  type BlackjackSeat,
  type BlackjackState,
  type BlackjackTableView,
  type HandOutcome,
  type PlayerHand,
} from '../src/blackjack/index.js';
import {
  BLACKJACK_HOST,
  BLACKJACK_TABLE_RULES,
  BlackjackTable,
  isSeatAction,
  type BlackjackSnapshot,
  type BlackjackTableCommand,
} from './blackjack-table.js';
import { setCheatTarget, xrayEnabled } from './cheat-console.js';
import { DAILY_REFILL, claimDailyRefill, loadLedger, netOf, recordResult, saveBalance, startingBalance } from './money-ledger.js';
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

type Tone = 'info' | 'win' | 'loss' | 'error';
type Client = TableClient<BlackjackSnapshot, BlackjackTableCommand>;

const CHIP_VALUES = [10, 25, 100, 500] as const;

const TURN_ACTIONS = [
  { action: 'HIT', label: 'Tirer', key: 'H' },
  { action: 'STAND', label: 'Rester', key: 'S' },
  { action: 'DOUBLE_DOWN', label: 'Doubler', key: 'D' },
  { action: 'SPLIT', label: 'Séparer', key: 'P' },
  { action: 'SURRENDER', label: 'Abandonner', key: 'A' },
] as const;

const OUTCOME_LABELS: Record<HandOutcome, string> = {
  BLACKJACK: 'Blackjack',
  WIN: 'Gagné',
  PUSH: 'Égalité',
  LOSS: 'Perdu',
  SURRENDER: 'Abandon',
};

const KEY_ACTIONS: Readonly<Record<string, string>> = { H: 'HIT', S: 'STAND', D: 'DOUBLE_DOWN', P: 'SPLIT', A: 'SURRENDER' };

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

function scoreLabel(hand: PlayerHand): string {
  const score = scoreHand(hand);
  if (score.isBlackjack) return 'Blackjack';
  if (score.isBust) return `${score.total} · Bust`;
  return score.isSoft ? `${score.total - 10} / ${score.total}` : String(score.total);
}

function signed(amount: number): string {
  return amount === 0 ? '' : formatSigned(amount);
}

const seatOfViewer = (view: BlackjackTableView): BlackjackSeat | null =>
  view.viewerSeat === null ? null : (view.seats[view.viewerSeat] ?? null);

/** Net d'une manche pour un siège (mains et assurance), ou null s'il n'y a pas joué. */
function roundNet(view: BlackjackTableView, seatIndex: number): number | null {
  const hands = view.settlements.filter((settlement) => settlement.seatIndex === seatIndex);
  const insurance = view.insuranceSettlements.filter((settlement) => settlement.seatIndex === seatIndex);
  if (hands.length === 0 && insurance.length === 0) return null;
  return sum(hands.map((s) => s.returned - s.stake)) + sum(insurance.map((s) => s.returned - s.stake));
}

/** Jetons engagés sur une manche en cours : perdus si le joueur quitte la table avant la fin. */
function chipsAtRisk(view: BlackjackTableView): number {
  const seat = seatOfViewer(view);
  if (seat === null || (view.phase !== 'INSURANCE' && view.phase !== 'PLAYER_TURNS')) return 0;
  const insurance = seat.insurance.status === 'TAKEN' ? seat.insurance.stake : 0;
  return sum(seat.hands.map((hand) => hand.bet)) + insurance;
}

/** Joue sur la table locale (tableId null) ou rejoint la table partagée désignée par le lien. */
export function mountBlackjack(root: HTMLElement, tableId: string | null = null): () => void {
  const engine = new BlackjackController(new CryptoRandomSource());
  const animator = new DealAnimator();
  const host = tableId === null ? new BlackjackTable(engine, loadPlayerName(), startingBalance('blackjack')) : null;
  let client: Client | null = host === null ? null : localClient(host, BLACKJACK_HOST);
  let share: ShareSession | null = null;
  let opening = false;
  let connecting = false;
  let joinError: string | null = null;
  let unsubscribe: () => void = () => {};
  let selectedBox = 0;
  let recordedRound: number | null = null;
  let localMessage: [string, Tone] | null = null;
  let last: BlackjackSnapshot | null = null;
  let lastBarHtml = '';
  let disposed = false;

  root.innerHTML = `
    <div class="game">
      <header class="topbar">
        <a class="back" href="#/">← Lobby</a>
        <h1>Blackjack</h1>
        <div class="topbar-stats">
          <div class="bankroll">Bilan <strong data-ledger></strong></div>
          <div class="bankroll">Bankroll <strong data-bankroll></strong></div>
        </div>
      </header>
      <div class="share-bar" data-share></div>
      <section class="felt bj-felt">
        <p class="rules-strip">Le croupier reste sur soft 17 · Blackjack payé 3:2 · Assurance payée 2:1 · 8 places : une main de plus par place libre</p>
        <div class="bj-dealer">
          <div class="zone-label">Croupier <span class="score-pill" data-dealer-score></span></div>
          <div class="card-row" data-dealer-cards></div>
        </div>
        <p class="message" data-message aria-live="polite"></p>
        <div class="bj-seats" data-seats></div>
        <p class="shoe-info" data-shoe></p>
      </section>
      <nav class="controls" data-controls></nav>
    </div>`;

  const shareEl = queryIn<HTMLElement>(root, '[data-share]');
  const bankrollEl = queryIn<HTMLElement>(root, '[data-bankroll]');
  const ledgerEl = queryIn<HTMLElement>(root, '[data-ledger]');
  const dealerCardsEl = queryIn<HTMLElement>(root, '[data-dealer-cards]');
  const dealerScoreEl = queryIn<HTMLElement>(root, '[data-dealer-score]');
  const messageEl = queryIn<HTMLElement>(root, '[data-message]');
  const seatsEl = queryIn<HTMLElement>(root, '[data-seats]');
  const shoeEl = queryIn<HTMLElement>(root, '[data-shoe]');
  const controlsEl = queryIn<HTMLElement>(root, '[data-controls]');

  const isShared = (snapshot: BlackjackSnapshot): boolean => host === null || share !== null || snapshot.players > 1;
  const hostSeat = (): BlackjackSeat | null => host?.state.seats.find((seat) => seat?.player.id === BLACKJACK_HOST) ?? null;

  function send(command: BlackjackTableCommand): void {
    localMessage = null;
    client?.send(command);
  }

  function renderLedger(): void {
    const net = netOf(loadLedger().blackjack);
    ledgerEl.textContent = formatSigned(net);
    ledgerEl.className = signClass(net);
  }

  function renderShareBar(snapshot: BlackjackSnapshot | null): void {
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

  /** Enregistre au bilan la manche que le joueur vient de terminer, une seule fois. */
  function recordRound(view: BlackjackTableView): void {
    if (recordedRound === null) {
      recordedRound = view.phase === 'ROUND_OVER' ? view.roundNumber : -1;
      return;
    }
    if (view.phase !== 'ROUND_OVER' || view.roundNumber === recordedRound || view.viewerSeat === null) return;
    recordedRound = view.roundNumber;
    const net = roundNet(view, view.viewerSeat);
    if (net !== null) recordResult('blackjack', net);
  }

  function describe(snapshot: BlackjackSnapshot, mySeat: BlackjackSeat | null, shared: boolean): [string, Tone] {
    const { view } = snapshot;
    if (mySeat === null) {
      if (host !== null) return ["Vous n'avez plus de jetons.", 'info'];
      return ['Manche en cours : vous serez assis dès la suivante.', 'info'];
    }
    switch (view.phase) {
      case 'ROUND_OVER': {
        const net = roundNet(view, mySeat.seatIndex);
        const prefix = view.dealerScore?.isBlackjack ? 'Blackjack du croupier. ' : '';
        if (net === null) return [`${prefix}Manche terminée.`, 'info'];
        if (net > 0) return [`${prefix}Vous gagnez ${formatChips(net)} jetons.`, 'win'];
        if (net < 0) return [`${prefix}Vous perdez ${formatChips(-net)} jetons.`, 'loss'];
        return [`${prefix}Égalité : votre mise vous est rendue.`, 'info'];
      }
      case 'INSURANCE':
        return mySeat.insurance.status === 'PENDING'
          ? ["Le croupier montre un As. Prenez-vous l'assurance ?", 'info']
          : ['Les autres joueurs décident de l’assurance…', 'info'];
      case 'PLAYER_TURNS': {
        const active = view.activeHand;
        if (active === null || active.seatIndex !== mySeat.seatIndex) {
          return [`${view.seats[active?.seatIndex ?? -1]?.player.displayName ?? 'Un joueur'} joue…`, 'info'];
        }
        const count = mySeat.hands.length;
        return [count > 1 ? `Main ${active.handIndex + 1} sur ${count} : à vous de jouer.` : 'À vous de jouer.', 'info'];
      }
      case 'BETTING':
        return [
          shared
            ? 'Misez sur une ou plusieurs cases (« + Main »), puis cliquez sur Prêt.'
            : 'Misez sur une ou plusieurs cases (« + Main »), puis distribuez.',
          'info',
        ];
    }
  }

  const spotButton = (box: number, label: string, variant: string): string =>
    `<button type="button" class="bet-spot ${variant} ${box === selectedBox ? 'selected' : ''}" data-action="BOX" data-box="${box}" ` +
    `aria-pressed="${box === selectedBox}" aria-label="Case ${box + 1}">${label}</button>`;

  function renderBoxes(view: BlackjackTableView, seat: BlackjackSeat, mine: boolean): string {
    if (!mine) {
      return seat.pendingBets.length === 0
        ? '<div class="bet-spot small">Mise</div>'
        : seat.pendingBets.map((bet) => `<div class="bet-spot small filled">${formatChips(bet)}</div>`).join('');
    }
    const spots = seat.pendingBets.map((bet, box) => spotButton(box, formatChips(bet), 'filled'));
    const next = seat.pendingBets.length;
    if (next === 0) spots.push(spotButton(0, 'Mise', ''));
    else if ((view.legalActions.boxRanges[next] ?? null) !== null) spots.push(spotButton(next, '+ Main', 'add'));
    return spots.join('');
  }

  function renderHands(view: BlackjackTableView, seat: BlackjackSeat): string {
    return seat.hands
      .map((hand, index) => {
        const active = view.activeHand?.seatIndex === seat.seatIndex && view.activeHand.handIndex === index;
        const settlement = view.settlements.find((s) => s.handId === hand.id);
        const cards = hand.cards.map((card, i) => animator.card(`${hand.id}-${i}-${card.rank}${card.suit}`, card)).join('');
        const badge =
          settlement === undefined
            ? ''
            : `<span class="badge outcome-${settlement.outcome.toLowerCase()}">${OUTCOME_LABELS[settlement.outcome]} ${signed(settlement.returned - settlement.stake)}</span>`;
        return `
          <article class="bj-hand ${active ? 'active' : ''}">
            <div class="card-row">${cards}</div>
            <div class="hand-meta">
              <span class="score-pill">${scoreLabel(hand)}</span>
              <span class="stake">Mise ${formatChips(hand.bet)}</span>
              ${badge}
            </div>
          </article>`;
      })
      .join('');
  }

  function renderSeats(snapshot: BlackjackSnapshot, mySeat: BlackjackSeat | null, shared: boolean): string {
    const { view } = snapshot;
    const others = view.seats.filter((seat): seat is BlackjackSeat => seat !== null && seat !== mySeat);
    const ordered = mySeat === null ? others : [mySeat, ...others];
    const seats = ordered
      .map((seat) => {
        const mine = seat === mySeat;
        const ready = view.phase === 'BETTING' && snapshot.ready.includes(seat.player.id) ? '<span class="badge ready-badge">Prêt</span>' : '';
        const head = shared
          ? `<header class="bj-seat-head"><span class="bj-seat-name">${escapeHtml(seat.player.displayName)}${mine ? ' · vous' : ''}</span>` +
            `<span class="bj-seat-bank">${formatChips(seat.bankroll)}</span>${ready}</header>`
          : '';
        const body = view.phase === 'BETTING' ? renderBoxes(view, seat, mine) : renderHands(view, seat);
        return `<section class="bj-seat ${mine ? 'mine' : ''} ${shared ? 'shared' : ''}">${head}<div class="bj-hands">${body}</div></section>`;
      })
      .join('');
    const waiting =
      snapshot.waiting.length === 0 ? '' : `<p class="bj-waiting">En attente de la prochaine manche : ${snapshot.waiting.map(escapeHtml).join(', ')}</p>`;
    return seats + waiting;
  }

  function renderControls(snapshot: BlackjackSnapshot, mySeat: BlackjackSeat | null, shared: boolean): string {
    const { view } = snapshot;
    const legal = new Set<string>(view.legalActions.actions);
    const button = (action: string, label: string, enabled: boolean, variant = '', key = ''): string =>
      `<button class="btn ${variant}" data-action="${action}" ${enabled ? '' : 'disabled'}>${label}${key ? `<kbd>${key}</kbd>` : ''}</button>`;

    if (mySeat === null) {
      return host !== null || startingBalance('blackjack') < view.rules.minBet
        ? refillButtonHtml('blackjack')
        : '<p class="waiting">Une place vous attend à la prochaine manche.</p>';
    }

    switch (view.phase) {
      case 'BETTING': {
        const pending = sum(mySeat.pendingBets);
        if (mySeat.bankroll + pending < view.rules.minBet) return refillButtonHtml('blackjack');
        const range = view.legalActions.boxRanges[selectedBox] ?? null;
        const rack = CHIP_VALUES.map((value) => {
          const enabled = range !== null && value >= range.min && value <= range.max;
          return `<button class="chip chip-${value}" data-action="CHIP" data-value="${value}" ${enabled ? '' : 'disabled'} aria-label="Ajouter ${value} sur la case ${selectedBox + 1}">${value}</button>`;
        }).join('');
        const able = view.seats.filter(
          (seat): seat is BlackjackSeat => seat !== null && seat.bankroll + sum(seat.pendingBets) >= view.rules.minBet,
        );
        const readyCount = able.filter((seat) => snapshot.ready.includes(seat.player.id)).length;
        let deal: string;
        if (!shared || able.length <= 1) deal = button('DEAL', 'Distribuer', pending > 0, 'primary', '↵');
        else if (snapshot.ready.includes(snapshot.me)) deal = button('DEAL', `Prêt ✓ ${readyCount}/${able.length}`, false, 'primary');
        else deal = button('DEAL', `${pending > 0 ? 'Prêt' : 'Passer la manche'} · ${readyCount}/${able.length}`, true, 'primary', '↵');
        return `<div class="chip-rack">${rack}</div>${button('CLEAR_BET', 'Effacer', legal.has('CLEAR_BET'), 'ghost')}${deal}`;
      }
      case 'INSURANCE': {
        if (mySeat.insurance.status !== 'PENDING') return '<p class="waiting">Les autres joueurs décident…</p>';
        const stake = sum(mySeat.hands.map((hand) => Math.floor(hand.bet / 2)));
        return (
          button('TAKE_INSURANCE', `Prendre l'assurance (${formatChips(stake)})`, legal.has('TAKE_INSURANCE'), 'primary') +
          button('DECLINE_INSURANCE', 'Refuser', legal.has('DECLINE_INSURANCE'), 'ghost')
        );
      }
      case 'PLAYER_TURNS': {
        const active = view.activeHand;
        if (active?.seatIndex !== mySeat.seatIndex) {
          return `<p class="waiting">${escapeHtml(view.seats[active?.seatIndex ?? -1]?.player.displayName ?? 'Un joueur')} joue…</p>`;
        }
        return TURN_ACTIONS.filter(({ action }) => action !== 'SURRENDER' || view.rules.surrender !== 'NONE')
          .map(({ action, label, key }) => button(action, label, legal.has(action), action === 'STAND' ? 'primary' : '', key))
          .join('');
      }
      case 'ROUND_OVER':
        return button('NEXT_ROUND', 'Nouvelle manche', true, 'primary', '↵');
    }
  }

  function renderJoin(): void {
    const balance = startingBalance('blackjack');
    bankrollEl.textContent = formatChips(balance);
    setHtml(dealerCardsEl, '<div class="card-slot"></div><div class="card-slot"></div>');
    dealerScoreEl.textContent = '';
    messageEl.textContent = '';
    shoeEl.textContent = '';
    setHtml(controlsEl, '');
    setHtml(
      seatsEl,
      joinPanelHtml({
        game: 'blackjack',
        gameLabel: 'Blackjack',
        name: loadPlayerName(),
        balance,
        minimum: BLACKJACK_TABLE_RULES.minBet,
        connecting,
        error: joinError,
      }),
    );
  }

  /** Carte réelle derrière une carte face cachée du croupier : rayons X, sur la table du créateur uniquement. */
  const hiddenCard = (index: number): Card | null => (host !== null && xrayEnabled() ? (host.state.dealer.cards[index] ?? null) : null);

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
    const { view } = snapshot;
    const mySeat = seatOfViewer(view);
    const shared = isShared(snapshot);
    animator.beginFrame();

    const maxBox = mySeat === null ? 0 : mySeat.pendingBets.length;
    if (selectedBox > maxBox || (view.legalActions.boxRanges[selectedBox] ?? null) === null) {
      selectedBox = Math.min(selectedBox, Math.max(0, maxBox - ((view.legalActions.boxRanges[maxBox] ?? null) === null ? 1 : 0)));
    }

    if (mySeat !== null) saveBalance('blackjack', mySeat.bankroll + sum(mySeat.pendingBets));
    recordRound(view);
    renderLedger();
    bankrollEl.textContent = formatChips(mySeat?.bankroll ?? startingBalance('blackjack'));

    setHtml(
      dealerCardsEl,
      view.dealerCards
        .map((card, index) =>
          animator.card(
            `d${view.roundNumber}-${index}-${card.faceUp ? 'up' : 'down'}`,
            card.faceUp ? card.card : hiddenCard(index),
            false,
            !card.faceUp && host !== null && xrayEnabled(),
          ),
        )
        .join('') || '<div class="card-slot"></div><div class="card-slot"></div>',
    );
    dealerScoreEl.textContent = view.dealerScore === null ? '' : String(view.dealerScore.total);

    const closed = client?.isClosed() ?? false;
    const [text, tone]: [string, Tone] = closed
      ? ['Le créateur a quitté : la table est fermée.', 'error']
      : snapshot.notice !== null
        ? [snapshot.notice, 'error']
        : (localMessage ?? describe(snapshot, mySeat, shared));
    messageEl.textContent = text;
    messageEl.dataset['tone'] = tone;
    shoeEl.textContent = `Sabot : ${view.shoe.cardsRemaining} cartes${view.shoe.reshufflePending ? ' · remélange à la prochaine manche' : ''}`;
    setHtml(seatsEl, renderSeats(snapshot, mySeat, shared));
    setHtml(controlsEl, closed ? '<a class="btn primary" href="#/blackjack">Jouer seul</a>' : renderControls(snapshot, mySeat, shared));
  }

  async function invite(): Promise<void> {
    if (host === null || share !== null || opening) return;
    opening = true;
    render();
    try {
      const session = await shareTable('blackjack', host, render);
      if (disposed) {
        session.close();
        return;
      }
      share = session;
      localMessage = ['Table ouverte : copiez le lien et envoyez-le à vos amis (8 joueurs maximum).', 'info'];
    } catch (error) {
      localMessage = [error instanceof Error ? error.message : String(error), 'error'];
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
      const joined = await joinSharedTable<BlackjackSnapshot, BlackjackTableCommand>('blackjack', tableId, loadPlayerName(), startingBalance('blackjack'));
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
        localMessage = ['Lien copié : il ne reste qu’à l’envoyer.', 'info'];
        render();
      },
      () => {
        localMessage = ['Copie impossible : sélectionnez le lien et copiez-le à la main.', 'error'];
        render();
      },
    );
  }

  function refill(): void {
    if (!claimDailyRefill('blackjack')) {
      localMessage = [REFILL_USED_MESSAGE, 'error'];
      render();
      return;
    }
    const seat = last === null ? null : seatOfViewer(last.view);
    const bankroll = (seat === null ? startingBalance('blackjack') : seat.bankroll + sum(seat.pendingBets)) + DAILY_REFILL;
    saveBalance('blackjack', bankroll);
    client?.send({ type: 'REBUY', bankroll });
    localMessage = [REFILL_DONE_MESSAGE, 'win'];
    render();
  }

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('button[data-action]');
    if (button === null || button.disabled) return;
    const action = button.dataset['action'] ?? '';
    switch (action) {
      case 'CHIP':
        send({ type: 'PLACE_BET', amount: Number(button.dataset['value']), box: selectedBox });
        break;
      case 'BOX':
        selectedBox = Number(button.dataset['box'] ?? 0);
        render();
        break;
      case 'DEAL':
        send({ type: 'READY' });
        break;
      case 'NEXT_ROUND':
        send({ type: 'NEXT_ROUND' });
        break;
      case 'REBUY':
        refill();
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
        if (isSeatAction(action)) send({ type: action });
    }
  }

  function onChange(event: Event): void {
    if (!(event.target instanceof HTMLInputElement) || !event.target.matches('[data-player-name]')) return;
    const name = savePlayerName(event.target.value);
    event.target.value = name;
    client?.send({ type: 'RENAME', name });
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement) return;
    const selector =
      event.key === 'Enter'
        ? '[data-action="DEAL"], [data-action="NEXT_ROUND"]'
        : `[data-action="${KEY_ACTIONS[event.key.toUpperCase()] ?? '-'}"]`;
    const button = controlsEl.querySelector<HTMLButtonElement>(selector);
    if (button !== null && !button.disabled) {
      event.preventDefault();
      button.click();
    }
  }

  /** Déroule le tirage du croupier à partir de la carte `from` du sabot, comme si tout le monde restait. */
  function dealerDraw(state: BlackjackState, dealerCards: readonly Card[], from: number): string {
    const cards = [...dealerCards];
    const drawn: Card[] = [];
    for (let index = from; dealerShouldHit(scoreCards(cards), state.rules); index += 1) {
      const card = state.shoe.cards[index];
      if (card === undefined) break;
      cards.push(card);
      drawn.push(card);
    }
    const score = scoreCards(cards);
    const total = score.isBust ? `${score.total}, bust` : String(score.total);
    return drawn.length === 0 ? `ne tirera pas (${total})` : `tirera ${drawn.map(cardText).join(' ')} (${total})`;
  }

  function foresee(): string {
    if (host === null) return GUEST_CHEAT_LOCK;
    const state = host.state;
    const { cards, nextIndex } = state.shoe;

    if (state.phase === 'BETTING' || state.phase === 'ROUND_OVER') {
      if (engine.project(state, BLACKJACK_HOST).shoe.reshufflePending) {
        return 'Le sabot sera remélangé avant la prochaine manche : l’avenir est flou.';
      }
      // Ordre de la donne : une carte par main (sièges puis cases), croupier visible, deuxième tour, hole card.
      const hands = state.seats.flatMap((seat) => {
        if (seat === null) return [];
        const mine = seat.player.id === BLACKJACK_HOST;
        const boxes = mine ? Math.max(1, seat.pendingBets.length) : state.phase === 'BETTING' ? seat.pendingBets.length : 0;
        return Array.from({ length: boxes }, (_, box) => ({ mine, box }));
      });
      const count = hands.length;
      const dealerUp = cards[nextIndex + count];
      const dealerHole = cards[nextIndex + 2 * count + 1];
      if (count === 0 || dealerUp === undefined || dealerHole === undefined) return 'Le sabot est presque vide.';
      const mine = hands.flatMap((hand, index) => {
        const first = cards[nextIndex + index];
        const second = cards[nextIndex + count + 1 + index];
        return hand.mine && first !== undefined && second !== undefined ? [{ box: hand.box, first, second }] : [];
      });
      const dealer = [dealerUp, dealerHole];
      const [only] = mine;
      let outcome = `Si tout le monde reste sur ses 2 cartes, le croupier ${dealerDraw(state, dealer, nextIndex + 2 * count + 2)}.`;
      if (scoreCards(dealer).isBlackjack) outcome = 'Le croupier aura Blackjack.';
      else if (mine.length === 1 && only !== undefined && scoreCards([only.first, only.second]).isBlackjack) outcome = 'Vous aurez Blackjack !';
      return [
        `Prochaines cartes du croupier : ${cardText(dealerUp)} (visible) · ${cardText(dealerHole)} (cachée)`,
        `Mes prochaines cartes : ${mine.map((hand) => `${mine.length > 1 ? `main ${hand.box + 1} ` : ''}${cardText(hand.first)} ${cardText(hand.second)}`).join(' · ') || '—'}`,
        outcome,
      ].join('\n');
    }

    const hole = state.dealer.cards[1];
    const dealerScore = scoreCards(state.dealer.cards);
    const nextCards = cards.slice(nextIndex, nextIndex + 5).map(cardText).join(' ');
    return [
      `Carte cachée du croupier : ${hole === undefined ? '—' : cardText(hole)} (total ${dealerScore.total})`,
      `Prochaines cartes du sabot : ${nextCards || '—'}`,
      dealerScore.isBlackjack ? 'Le croupier a Blackjack.' : `Si tout le monde reste, le croupier ${dealerDraw(state, state.dealer.cards, nextIndex)}.`,
    ].join('\n');
  }

  if (host !== null) {
    const table = host;
    setCheatTarget({
      games: ['blackjack'],
      getBalance: () => hostSeat()?.bankroll ?? 0,
      setBalance: (_game, amount) => {
        const value = Number(amount);
        const seat = hostSeat();
        if (seat === null) {
          // Créateur ruiné, donc debout : le nouveau solde le rassoit.
          table.command(BLACKJACK_HOST, { type: 'REBUY', bankroll: value });
          return null;
        }
        const credited: BlackjackSeat = { ...seat, bankroll: chips(value) };
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
  root.addEventListener('change', onChange);
  window.addEventListener('keydown', onKey);
  if (client !== null) unsubscribe = client.subscribe(render);
  render();

  return () => {
    disposed = true;
    const abandoned = last === null || client?.isClosed() ? 0 : chipsAtRisk(last.view);
    if (abandoned > 0) recordResult('blackjack', -abandoned);
    unsubscribe();
    share?.close();
    client?.close();
    setCheatTarget(null);
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    window.removeEventListener('keydown', onKey);
  };
}
