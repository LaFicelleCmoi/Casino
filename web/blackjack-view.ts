import { CryptoRandomSource, chips, type Card } from '../src/core/index.js';
import {
  BlackjackController,
  dealerShouldHit,
  scoreCards,
  scoreHand,
  type BlackjackDealerAction,
  type BlackjackRules,
  type BlackjackSeat,
  type BlackjackState,
  type BlackjackTableView,
  type HandOutcome,
  type PlayerHand,
} from '../src/blackjack/index.js';
import {
  HOUSE_CHOICES,
  arrivalChance,
  betAppetite,
  departureChance,
  guestTip,
  houseEdge,
  houseMood,
  sideBetSteps,
  tipChance,
  type HouseMood,
  type HouseRules,
  type ServiceNote,
} from './blackjack-house.js';
import {
  BLACKJACK_HOST,
  BLACKJACK_TABLE_RULES,
  BlackjackTable,
  isBotPlayer,
  isDealerMove,
  isSeatAction,
  type BlackjackDealerInfo,
  type BlackjackSnapshot,
  type BlackjackTableCommand,
} from './blackjack-table.js';
import { setCheatTarget, xrayEnabled } from './cheat-console.js';
import { DAILY_REFILL, claimDailyRefill, loadLedger, netOf, recordResult, saveBalance, startingBalance } from './money-ledger.js';
import { loadDealerSave, saveDealerSave } from './dealer-save.js';
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
/** Raccourcis du panneau « rendre des jetons » du créateur. */
const GRANT_VALUES = [100, 500, 1000, 5000] as const;

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

/** Libellés des règles de la maison, dans l'ordre du panneau du croupier. */
const HOUSE_ROWS: readonly { readonly key: keyof HouseRules; readonly label: string; readonly option: (value: never) => string }[] = [
  { key: 'payout', label: 'Blackjack payé', option: (value: string) => value },
  { key: 'soft17', label: 'Soft 17 du croupier', option: (value: string) => (value === 'HIT' ? 'Tire' : 'Reste') },
  { key: 'decks', label: 'Sabot', option: (value: number) => `${value} jeu${value > 1 ? 'x' : ''}` },
  {
    key: 'double',
    label: 'Doubler sur',
    option: (value: string) => ({ ANY_TWO: 'Toutes mains', NINE_TO_ELEVEN: '9 à 11', TEN_OR_ELEVEN: '10 et 11' })[value] ?? value,
  },
  { key: 'doubleAfterSplit', label: 'Double après split', option: (value: boolean) => (value ? 'Oui' : 'Non') },
  { key: 'surrender', label: 'Abandon', option: (value: string) => (value === 'LATE' ? 'Oui' : 'Non') },
  { key: 'minBet', label: 'Mise minimum', option: (value: number) => formatChips(value) },
  { key: 'maxBet', label: 'Mise maximum', option: (value: number) => formatChips(value) },
  { key: 'perfectPairs', label: 'Paires parfaites', option: (value: boolean) => (value ? 'Oui' : 'Non') },
  { key: 'serviceLength', label: 'Service', option: (value: number) => `${value} manches` },
];

const MOOD_LABELS: Record<HouseMood, string> = { GENEROUS: 'Généreuse', BALANCED: 'Équilibrée', TIGHT: 'Serrée', STINGY: 'Radine' };

const PAIR_LABELS = { PERFECT: 'Paire parfaite', COLORED: 'Paire de couleur', MIXED: 'Paire' } as const;

const RECORD_KEY = 'casino-engine:croupier-record:v1';

const percent = (value: number): string => `${Math.round(value * 100)} %`;
const edgeText = (edge: number): string => `${edge < 0 ? '−' : ''}${Math.abs(edge).toFixed(2).replace('.', ',')} %`;

/** Bandeau des règles, lu par tous les joueurs : il suit les règles de la maison du croupier. */
function rulesStrip(rules: BlackjackRules, house: HouseRules): string {
  const { numerator, denominator } = rules.blackjackPayout;
  return [
    rules.dealerHitsSoft17 ? 'Le croupier tire sur soft 17' : 'Le croupier reste sur soft 17',
    `Blackjack payé ${numerator}:${denominator}`,
    'Assurance payée 2:1',
    `Sabot de ${rules.deckCount} jeu${rules.deckCount > 1 ? 'x' : ''}`,
    `Mises ${formatChips(rules.minBet)} à ${formatChips(rules.maxBet)}`,
    ...(rules.surrender === 'LATE' ? ['Abandon autorisé'] : []),
    ...(house.perfectPairs ? ['Paires parfaites 25:1 · 12:1 · 6:1'] : []),
    '8 places : une main de plus par place libre',
  ].join(' · ');
}

function loadRecord(): { readonly score: number; readonly grade: string } | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECORD_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return null;
    const { score, grade } = raw as Record<string, unknown>;
    return typeof score === 'number' && typeof grade === 'string' ? { score, grade } : null;
  } catch {
    return null;
  }
}

function saveRecord(note: ServiceNote): void {
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify({ score: note.score, grade: note.grade }));
  } catch {
    // Stockage indisponible : le record ne sera simplement pas retenu.
  }
}

const DEALER_LABELS: Record<BlackjackDealerAction, string> = {
  REVEAL_HOLE_CARD: 'Retourner la carte cachée',
  DEALER_HIT: 'Tirer une carte',
  DEALER_STAND: "S'arrêter et régler",
};

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

/** Net d'une manche pour un siège, Paires parfaites comprises. */
function seatNet(snapshot: BlackjackSnapshot, seatIndex: number): number | null {
  const main = roundNet(snapshot.view, seatIndex);
  const side = snapshot.sideResults.filter((result) => result.seatIndex === seatIndex);
  if (main === null && side.length === 0) return null;
  return (main ?? 0) + sum(side.map((result) => result.net));
}

const listNames = (names: readonly string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} et ${names.at(-1) ?? ''}`;

/** « Hugo quitte la table · Zoé et Adam s'installent. » */
function movementText(movement: { readonly left: readonly string[]; readonly arrived: readonly string[] }): string {
  const parts: string[] = [];
  if (movement.left.length > 0) parts.push(`${listNames(movement.left)} ${movement.left.length > 1 ? 'quittent' : 'quitte'} la table`);
  if (movement.arrived.length > 0) parts.push(`${listNames(movement.arrived)} ${movement.arrived.length > 1 ? "s'installent" : "s'installe"}`);
  return `${parts.join(' · ')}.`;
}

/** Joue sur la table locale (tableId null) ou rejoint la table partagée désignée par le lien. */
export function mountBlackjack(root: HTMLElement, tableId: string | null = null): () => void {
  const rng = new CryptoRandomSource();
  const engine = new BlackjackController(rng);
  const animator = new DealAnimator();
  const host = tableId === null ? new BlackjackTable(engine, rng, loadPlayerName(), startingBalance('blackjack'), loadDealerSave()) : null;
  let client: Client | null = host === null ? null : localClient(host, BLACKJACK_HOST);
  let share: ShareSession | null = null;
  let opening = false;
  let connecting = false;
  let joinError: string | null = null;
  let unsubscribe: () => void = () => {};
  let selectedBox = 0;
  /** Panneau ouvert à la place des commandes : rendre des jetons à un invité, ou renommer un bot. */
  let panel: { readonly kind: 'grant' | 'rename'; readonly target: string } | null = null;
  let credited: number | null = null;
  let tipped: number | null = null;
  let guestTipSerial: number | null = null;
  let houseOpen = false;
  /** Dernière note de service vue, et le record battu (ou non) qu'elle a donné. */
  let gradedNote: ServiceNote | null = null;
  let previousRecord: ReturnType<typeof loadRecord> = null;
  /** Dernière manche dont le résultat de la banque a été mis en avant : l'annonce ne rejaillit qu'une fois par manche. */
  let bankBannerRound: number | null = null;
  let recordedRound: number | null = null;
  let recordedBankRound: number | null = null;
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
          <div class="bankroll"><span data-bankroll-label>Bankroll</span> <strong data-bankroll></strong></div>
          <div class="bankroll" data-tips-box hidden>Pourboires <strong data-tips></strong></div>
        </div>
      </header>
      <div class="share-bar" data-share></div>
      <section class="felt bj-felt">
        <p class="rules-strip" data-rules></p>
        <div class="bj-dealer">
          <div class="zone-label"><span data-dealer-name>Croupier</span> <span class="score-pill" data-dealer-score></span></div>
          <div class="card-row" data-dealer-cards></div>
          <div class="dealer-role" data-dealer-role></div>
          <div class="dealer-desk" data-desk></div>
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
  const dealerNameEl = queryIn<HTMLElement>(root, '[data-dealer-name]');
  const dealerRoleEl = queryIn<HTMLElement>(root, '[data-dealer-role]');
  const bankrollLabelEl = queryIn<HTMLElement>(root, '[data-bankroll-label]');
  const dealerScoreEl = queryIn<HTMLElement>(root, '[data-dealer-score]');
  const messageEl = queryIn<HTMLElement>(root, '[data-message]');
  const seatsEl = queryIn<HTMLElement>(root, '[data-seats]');
  const shoeEl = queryIn<HTMLElement>(root, '[data-shoe]');
  const controlsEl = queryIn<HTMLElement>(root, '[data-controls]');
  const rulesEl = queryIn<HTMLElement>(root, '[data-rules]');
  const deskEl = queryIn<HTMLElement>(root, '[data-desk]');
  const tipsBoxEl = queryIn<HTMLElement>(root, '[data-tips-box]');
  const tipsEl = queryIn<HTMLElement>(root, '[data-tips]');

  const isShared = (snapshot: BlackjackSnapshot): boolean =>
    host === null || share !== null || snapshot.players > 1 || snapshot.dealer !== null;
  /** Banque du croupier si c'est ce joueur qui tient ce rôle. */
  const dealerOf = (snapshot: BlackjackSnapshot): BlackjackDealerInfo | null =>
    snapshot.dealer !== null && snapshot.me === BLACKJACK_HOST ? snapshot.dealer : null;
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
  function recordRound(snapshot: BlackjackSnapshot): void {
    const { view } = snapshot;
    if (recordedRound === null) {
      recordedRound = view.phase === 'ROUND_OVER' ? view.roundNumber : -1;
      return;
    }
    if (view.phase !== 'ROUND_OVER' || view.roundNumber === recordedRound || view.viewerSeat === null) return;
    recordedRound = view.roundNumber;
    const net = seatNet(snapshot, view.viewerSeat);
    if (net !== null) recordResult('blackjack', net);
  }

  /** Enregistre au bilan la variation de la banque sur chaque manche réglée, une seule fois. */
  function recordBank(dealer: BlackjackDealerInfo): void {
    const round = dealer.lastRound;
    if (recordedBankRound === null) {
      recordedBankRound = round?.roundNumber ?? -1;
      return;
    }
    if (round === null || round.roundNumber === recordedBankRound) return;
    recordedBankRound = round.roundNumber;
    // Les pourboires sont un gain du croupier : ils rejoignent son solde à la fin du service.
    recordResult('blackjack', round.net + round.tips);
  }

  function describeDealer(snapshot: BlackjackSnapshot, dealer: BlackjackDealerInfo): [string, Tone] {
    const { view } = snapshot;
    const seats = view.seats.filter((seat): seat is BlackjackSeat => seat !== null);
    switch (view.phase) {
      case 'BETTING': {
        if (dealer.service.note !== null) return [`Service terminé : note ${dealer.service.note.grade}. Lancez un nouveau service.`, 'info'];
        if (dealer.bank <= 0) return ['La banque est vide : rechargez-la pour distribuer.', 'error'];
        const bettors = seats.filter((seat) => seat.pendingBets.length > 0).length;
        const moves = dealer.movement === null ? '' : `${movementText(dealer.movement)} `;
        if (seats.length === 0) return [`${moves}Table vide : personne ne s'assoit pour l'instant.`, 'info'];
        return [`${moves}${bettors} joueur${bettors > 1 ? 's' : ''} sur ${seats.length} ${bettors > 1 ? 'ont' : 'a'} misé. Distribuez quand vous voulez.`, 'info'];
      }
      case 'INSURANCE':
        return ['Vous montrez un As : les joueurs décident de l’assurance…', 'info'];
      case 'PLAYER_TURNS':
        return [`${view.seats[view.activeHand?.seatIndex ?? -1]?.player.displayName ?? 'Un joueur'} joue…`, 'info'];
      case 'DEALER_TURN': {
        const [action] = view.dealerActions;
        const total = view.dealerScore?.total ?? 0;
        if (action === 'REVEAL_HOLE_CARD') return ['À vous : retournez la carte cachée.', 'info'];
        if (action === 'DEALER_HIT') return [`${total} : sous 17, vous devez tirer.`, 'info'];
        if (view.dealerScore?.isBust) return [`Bust à ${total} : les mains encore en jeu sont payées.`, 'info'];
        return [total < 17 ? 'Plus aucune main à battre : réglez les mises.' : `Vous restez à ${total} : réglez les mises.`, 'info'];
      }
      case 'ROUND_OVER': {
        const round = dealer.lastRound?.roundNumber === view.roundNumber ? dealer.lastRound : null;
        const net = round?.net ?? 0;
        const prefix = view.dealerScore?.isBlackjack ? 'Blackjack du croupier ! ' : '';
        const tips = round !== null && round.tips > 0 ? ` · ${formatChips(round.tips)} de pourboires` : '';
        const end = dealer.service.note === null ? '' : ` Service terminé : note ${dealer.service.note.grade} !`;
        if (net > 0) return [`${prefix}La banque encaisse ${formatChips(net)} jetons${tips}.${end}`, 'win'];
        if (net < 0) return [`${prefix}La banque paie ${formatChips(-net)} jetons${tips}.${end}`, 'loss'];
        return [`${prefix}Manche blanche pour la banque${tips}.${end}`, 'info'];
      }
    }
  }

  function describe(snapshot: BlackjackSnapshot, mySeat: BlackjackSeat | null, shared: boolean): [string, Tone] {
    const { view } = snapshot;
    const asDealer = dealerOf(snapshot);
    if (asDealer !== null) return describeDealer(snapshot, asDealer);
    if (mySeat === null) {
      if (host !== null) return ["Vous n'avez plus de jetons.", 'info'];
      return ['Manche en cours : vous serez assis dès la suivante.', 'info'];
    }
    switch (view.phase) {
      case 'ROUND_OVER': {
        const net = seatNet(snapshot, mySeat.seatIndex);
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
      case 'DEALER_TURN':
        return [`${snapshot.dealer?.name ?? 'Le croupier'} joue sa main…`, 'info'];
      case 'BETTING':
        if (snapshot.dealer !== null) return ['Misez sur une ou plusieurs cases, puis cliquez sur Prêt : le croupier distribue.', 'info'];
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

  /** Paires parfaites (mise ou résultat) et pourboire de la manche, sous le nom du joueur. */
  function seatExtras(snapshot: BlackjackSnapshot, seatIndex: number): string {
    const badges: string[] = [];
    const pending = snapshot.view.phase === 'BETTING' ? snapshot.sideBets.find((bet) => bet.seatIndex === seatIndex) : undefined;
    if (pending !== undefined) badges.push(`<span class="badge side-badge">Paires ${formatChips(pending.amount)}</span>`);
    for (const result of snapshot.sideResults.filter((side) => side.seatIndex === seatIndex)) {
      const label = result.pair === null ? 'Paires' : PAIR_LABELS[result.pair];
      badges.push(`<span class="badge ${result.net > 0 ? 'side-win' : 'side-loss'}">${label} ${formatSigned(result.net)}</span>`);
    }
    const tip = sum((snapshot.dealer?.roundTips ?? []).filter((entry) => entry.seatIndex === seatIndex).map((entry) => entry.amount));
    if (tip > 0) badges.push(`<span class="badge tip-badge">Pourboire +${formatChips(tip)}</span>`);
    return badges.length === 0 ? '' : `<div class="seat-extras">${badges.join('')}</div>`;
  }

  function renderSeats(snapshot: BlackjackSnapshot, mySeat: BlackjackSeat | null, shared: boolean): string {
    const { view } = snapshot;
    const others = view.seats.filter((seat): seat is BlackjackSeat => seat !== null && seat !== mySeat);
    const ordered = mySeat === null ? others : [mySeat, ...others];
    const seats = ordered
      .map((seat) => {
        const mine = seat === mySeat;
        const ready = view.phase === 'BETTING' && snapshot.ready.includes(seat.player.id) ? '<span class="badge ready-badge">Prêt</span>' : '';
        const bot = isBotPlayer(seat.player.id) ? '<span class="badge bot-badge">Bot</span>' : '';
        // Seul le créateur peut rendre des jetons, et seulement aux vrais joueurs qui ont rejoint sa table.
        const credit =
          host !== null && !mine && !isBotPlayer(seat.player.id)
            ? `<button type="button" class="seat-credit" data-action="GRANT_OPEN" data-player="${escapeHtml(seat.player.id)}" ` +
              `aria-label="Rendre des jetons à ${escapeHtml(seat.player.displayName)}">+ Jetons</button>`
            : '';
        // Le croupier renomme ses bots d'un clic sur le crayon.
        const rename =
          dealerOf(snapshot) !== null && isBotPlayer(seat.player.id)
            ? `<button type="button" class="seat-rename" data-action="RENAME_OPEN" data-player="${escapeHtml(seat.player.id)}" ` +
              `aria-label="Renommer ${escapeHtml(seat.player.displayName)}" title="Renommer">✎</button>`
            : '';
        const head = shared
          ? `<header class="bj-seat-head"><span class="bj-seat-name">${escapeHtml(seat.player.displayName)}${mine ? ' · vous' : ''}</span>${rename}${bot}` +
            `<span class="bj-seat-bank">${formatChips(seat.bankroll)}</span>${ready}${credit}</header>`
          : '';
        const body = view.phase === 'BETTING' ? renderBoxes(view, seat, mine) : renderHands(view, seat);
        const extras = seatExtras(snapshot, seat.seatIndex);
        return `<section class="bj-seat ${mine ? 'mine' : ''} ${shared ? 'shared' : ''}">${head}${extras}<div class="bj-hands">${body}</div></section>`;
      })
      .join('');
    const waiting =
      snapshot.waiting.length === 0 ? '' : `<p class="bj-waiting">En attente de la prochaine manche : ${snapshot.waiting.map(escapeHtml).join(', ')}</p>`;
    return seats + waiting;
  }

  /**
   * Panneau du créateur pour rendre des jetons à un joueur. Il remplace les commandes le temps de la saisie : ainsi il
   * reste à portée de pouce sur téléphone, et son HTML ne dépend que du joueur visé, donc le montant tapé survit aux
   * rafraîchissements de la table.
   */
  function grantPanelHtml(name: string): string {
    const quick = GRANT_VALUES.map(
      (value) => `<button type="button" class="btn ghost grant-quick" data-action="GRANT_ADD" data-value="${value}">+${formatChips(value)}</button>`,
    ).join('');
    return `
      <div class="grant-panel">
        <p class="grant-title">Rendre des jetons à <strong>${escapeHtml(name)}</strong> <span>· votre banque n'est pas débitée</span></p>
        <div class="grant-row">${quick}</div>
        <div class="grant-row">
          <input class="grant-input" type="number" inputmode="numeric" min="1" step="10" placeholder="Montant" aria-label="Jetons à rendre" data-grant-amount>
          <button class="btn primary" data-action="GRANT">Créditer</button>
          <button class="btn ghost" data-action="GRANT_CLOSE">Annuler</button>
        </div>
      </div>`;
  }

  /** Panneau du croupier pour renommer un bot ; comme celui des jetons, son HTML ne bouge pas pendant la saisie. */
  function renamePanelHtml(name: string): string {
    return `
      <div class="grant-panel">
        <p class="grant-title">Renommer le bot <strong>${escapeHtml(name)}</strong> <span>· il gardera ce nom à ses prochaines venues</span></p>
        <div class="grant-row">
          <input class="grant-input rename-input" type="text" maxlength="16" autocomplete="off" value="${escapeHtml(name)}" aria-label="Nouveau nom du bot" data-bot-name>
          <button class="btn primary" data-action="RENAME_BOT">Renommer</button>
          <button class="btn ghost" data-action="PANEL_CLOSE">Annuler</button>
        </div>
      </div>`;
  }

  function renderControls(snapshot: BlackjackSnapshot, mySeat: BlackjackSeat | null, shared: boolean): string {
    const { view } = snapshot;
    const legal = new Set<string>(view.legalActions.actions);
    const button = (action: string, label: string, enabled: boolean, variant = '', key = '', move = ''): string =>
      `<button class="btn ${variant}" data-action="${action}" ${move ? `data-move="${move}"` : ''} ${enabled ? '' : 'disabled'}>${label}${key ? `<kbd>${key}</kbd>` : ''}</button>`;

    const asDealer = dealerOf(snapshot);
    if (asDealer !== null) {
      const seats = view.seats.filter((seat): seat is BlackjackSeat => seat !== null);
      if (asDealer.service.note !== null && (view.phase === 'BETTING' || view.phase === 'ROUND_OVER')) {
        return button('NEW_SERVICE', 'Nouveau service', true, 'primary', '↵');
      }
      switch (view.phase) {
        case 'BETTING': {
          if (asDealer.bank <= 0) return refillButtonHtml('blackjack');
          const humans = seats.filter((seat) => !isBotPlayer(seat.player.id));
          const readyCount = humans.filter((seat) => snapshot.ready.includes(seat.player.id)).length;
          const status = humans.length === 0 ? '' : `<p class="waiting">Joueurs prêts : ${readyCount}/${humans.length}</p>`;
          return status + button('DEALER', 'Distribuer', seats.some((seat) => seat.pendingBets.length > 0), 'primary', '↵', 'DEAL');
        }
        case 'INSURANCE':
          return '<p class="waiting">Les joueurs décident de l’assurance…</p>';
        case 'PLAYER_TURNS':
          return `<p class="waiting">${escapeHtml(view.seats[view.activeHand?.seatIndex ?? -1]?.player.displayName ?? 'Un joueur')} joue…</p>`;
        case 'DEALER_TURN':
          return view.dealerActions.map((action) => button('DEALER', DEALER_LABELS[action], true, 'primary', '↵', action)).join('');
        case 'ROUND_OVER':
          return button('NEXT_ROUND', 'Nouvelle manche', true, 'primary', '↵');
      }
    }

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
        if (snapshot.dealer !== null) {
          deal = snapshot.ready.includes(snapshot.me)
            ? button('DEAL', 'Prêt ✓ · le croupier distribue', false, 'primary')
            : button('DEAL', pending > 0 ? 'Prêt' : 'Passer la manche', true, 'primary', '↵');
        } else if (!shared || able.length <= 1) deal = button('DEAL', 'Distribuer', pending > 0, 'primary', '↵');
        else if (snapshot.ready.includes(snapshot.me)) deal = button('DEAL', `Prêt ✓ ${readyCount}/${able.length}`, false, 'primary');
        else deal = button('DEAL', `${pending > 0 ? 'Prêt' : 'Passer la manche'} · ${readyCount}/${able.length}`, true, 'primary', '↵');
        const extras = snapshot.dealer === null ? '' : sideBetButton(snapshot, mySeat) + tipButton(snapshot);
        return `<div class="chip-rack">${rack}</div>${button('CLEAR_BET', 'Effacer', legal.has('CLEAR_BET'), 'ghost')}${extras}${deal}`;
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
      case 'DEALER_TURN':
        return `<p class="waiting">${escapeHtml(snapshot.dealer?.name ?? 'Le croupier')} joue sa main…</p>`;
      case 'ROUND_OVER':
        return snapshot.dealer !== null
          ? `<p class="waiting">Le croupier lance la manche suivante.</p>${tipButton(snapshot)}`
          : button('NEXT_ROUND', 'Nouvelle manche', true, 'primary', '↵');
    }
  }

  /** Paires parfaites du joueur : chaque clic passe au palier suivant (non → minimum → double → ×5 → non). */
  function sideBetButton(snapshot: BlackjackSnapshot, mySeat: BlackjackSeat): string {
    if (!snapshot.house.perfectPairs) return '';
    const steps = sideBetSteps(snapshot.house);
    const current = snapshot.sideBets.find((bet) => bet.seatIndex === mySeat.seatIndex)?.amount ?? 0;
    const next = steps[(steps.indexOf(current) + 1) % steps.length] ?? 0;
    return (
      `<button class="btn ghost side-toggle" data-action="SIDE_BET" data-amount="${next}" title="Paire parfaite 25:1 · de couleur 12:1 · simple 6:1">` +
      `Paires parfaites : ${current === 0 ? 'non' : formatChips(current)}</button>`
    );
  }

  function tipButton(snapshot: BlackjackSnapshot): string {
    return snapshot.dealer === null || snapshot.me === BLACKJACK_HOST || seatOfViewer(snapshot.view) === null
      ? ''
      : `<button class="btn ghost" data-action="TIP">Pourboire au croupier (${formatChips(guestTip(snapshot.house))})</button>`;
  }

  /** Panneau du croupier : barre du service en cours et règles de la maison, ou note de fin de service. */
  function renderDesk(snapshot: BlackjackSnapshot): string {
    const dealer = dealerOf(snapshot);
    if (dealer === null) return '';
    const { view } = snapshot;
    const { service } = dealer;
    if (service.note !== null) return summaryHtml(dealer, service.note);
    const seated = view.seats.filter((seat) => seat !== null).length;
    const bar =
      `<p class="service-bar"><span>Service <strong>${service.stats.rounds}/${service.length}</strong> manches</span>` +
      `<span>Table <strong>${seated}/${view.rules.seatCount}</strong></span>` +
      `<span>Pourboires <strong>${formatChips(dealer.tips)}</strong> · ${formatChips(dealer.lifetimeTips)} au total</span>` +
      `<span>Gain théorique <strong>${formatSigned(Math.round(service.stats.theo))}</strong></span></p>`;
    return bar + housePanelHtml(snapshot.house, view.phase === 'BETTING' || view.phase === 'ROUND_OVER');
  }

  function housePanelHtml(house: HouseRules, editable: boolean): string {
    const edge = houseEdge(house);
    const mood = houseMood(house);
    const rows = HOUSE_ROWS.map(({ key, label, option }) => {
      const buttons = (HOUSE_CHOICES[key] as readonly (string | number | boolean)[])
        .map((choice) => {
          const invalid = key === 'maxBet' && (choice as number) < house.minBet * 10;
          return (
            `<button type="button" class="seg-btn" data-action="HOUSE" data-key="${key}" data-value="${String(choice)}" ` +
            `aria-pressed="${house[key] === choice}" ${editable && !invalid ? '' : 'disabled'}>${escapeHtml((option as (value: unknown) => string)(choice))}</button>`
          );
        })
        .join('');
      return `<div class="house-row"><span class="house-label">${label}</span><div class="seg">${buttons}</div></div>`;
    }).join('');
    const appetite = betAppetite(house);
    const bets = appetite < 0.85 ? 'plus petites' : appetite > 1.15 ? 'plus grosses' : 'habituelles';
    const effects =
      `Chaque manche, une place libre trouve preneur dans ${percent(arrivalChance(house))} des cas, un joueur s'en va dans ` +
      `${percent(departureChance(house, false))}, et un gagnant laisse un pourboire dans ${percent(tipChance(house))}. Mises ${bets}.` +
      (edge < 0 ? ' Attention : avec ces règles, ce sont les joueurs qui ont l’avantage.' : '') +
      (house.perfectPairs ? ' Paires parfaites : 4,1 % d’avantage sur chaque mise annexe.' : '');
    return (
      `<details class="house-panel" data-house ${houseOpen ? 'open' : ''}>` +
      `<summary>Règles de la maison · avantage <strong>${edgeText(edge)}</strong> · <span class="mood mood-${mood.toLowerCase()}">${MOOD_LABELS[mood]}</span></summary>` +
      `<p class="house-effects">${effects}</p><div class="house-grid">${rows}</div>` +
      `${editable ? '' : '<p class="house-lock">Modifiable entre deux manches.</p>'}</details>`
    );
  }

  function summaryHtml(dealer: BlackjackDealerInfo, note: ServiceNote): string {
    const { stats } = dealer.service;
    const record = previousRecord;
    const recordLine =
      record === null
        ? 'Premier service noté : c’est votre record.'
        : note.score > record.score
          ? `Nouveau record ! L’ancien : ${record.grade} (${record.score}/100).`
          : `Record à battre : ${record.grade} (${record.score}/100).`;
    const parts = note.parts
      .map((part) => `<li><span>${part.label}</span><span class="part-detail">${escapeHtml(part.detail)}</span><strong>${part.points}</strong></li>`)
      .join('');
    return `
      <section class="service-summary">
        <div class="grade grade-${note.grade.toLowerCase()}" aria-label="Note ${note.grade}">${note.grade}</div>
        <div class="summary-body">
          <h3>Service terminé · ${note.score}/100</h3>
          <p>Banque ${formatSigned(stats.bankNet)} · ${formatChips(stats.tips)} jetons de pourboires versés à votre banque · ${formatChips(dealer.lifetimeTips)} reçus depuis vos débuts</p>
          <ul class="summary-parts">${parts}</ul>
          <p class="summary-record">${recordLine}</p>
        </div>
      </section>`;
  }

  /** Bouton de changement de rôle du créateur, actif entre deux manches. */
  function roleButton(view: BlackjackTableView, dealerMode: boolean): string {
    const betweenRounds = view.phase === 'BETTING' || view.phase === 'ROUND_OVER';
    return (
      `<button class="btn ghost dealer-toggle" data-action="DEALER_MODE" data-enabled="${!dealerMode}" ${betweenRounds ? '' : 'disabled'}>` +
      `${dealerMode ? 'Redevenir joueur' : 'Devenir croupier'}</button>`
    );
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
    // Le total reçu ne peut que monter : sa hausse annonce au joueur les jetons que le créateur vient de lui rendre.
    if (credited === null || snapshot.credited < credited) credited = snapshot.credited;
    else if (snapshot.credited > credited) {
      localMessage = [`Le croupier vous rend ${formatChips(snapshot.credited - credited)} jetons.`, 'win'];
      credited = snapshot.credited;
    }
    const { view } = snapshot;
    const mySeat = seatOfViewer(view);
    const shared = isShared(snapshot);
    animator.beginFrame();

    const maxBox = mySeat === null ? 0 : mySeat.pendingBets.length;
    if (selectedBox > maxBox || (view.legalActions.boxRanges[selectedBox] ?? null) === null) {
      selectedBox = Math.min(selectedBox, Math.max(0, maxBox - ((view.legalActions.boxRanges[maxBox] ?? null) === null ? 1 : 0)));
    }

    const asDealer = dealerOf(snapshot);
    if (asDealer !== null) {
      // Solde du croupier : sa banque plus la cagnotte du service, qui lui revient à la fin.
      saveBalance('blackjack', asDealer.bank + asDealer.tips);
      recordBank(asDealer);
      const tip = asDealer.lastGuestTip;
      if (guestTipSerial === null) guestTipSerial = tip?.serial ?? 0;
      else if (tip !== null && tip.serial > guestTipSerial) {
        guestTipSerial = tip.serial;
        localMessage = [`${tip.name} vous laisse ${formatChips(tip.amount)} jetons de pourboire.`, 'win'];
      }
      const note = asDealer.service.note;
      if (note !== null && note !== gradedNote) {
        gradedNote = note;
        previousRecord = loadRecord();
        if (previousRecord === null || note.score > previousRecord.score) saveRecord(note);
      }
    } else if (mySeat !== null) {
      saveBalance('blackjack', mySeat.bankroll + sum(mySeat.pendingBets));
    }
    // Pourboires laissés au croupier : une dépense du joueur, comptée à son bilan.
    if (tipped === null || snapshot.tipped < tipped) tipped = snapshot.tipped;
    else if (snapshot.tipped > tipped) {
      recordResult('blackjack', -(snapshot.tipped - tipped), false);
      tipped = snapshot.tipped;
    }
    recordRound(snapshot);
    renderLedger();
    bankrollLabelEl.textContent = asDealer === null ? 'Bankroll' : 'Banque';
    tipsBoxEl.hidden = asDealer === null;
    tipsEl.textContent = formatChips(asDealer?.tips ?? 0);
    rulesEl.textContent = rulesStrip(view.rules, snapshot.house);
    setHtml(deskEl, renderDesk(snapshot));
    bankrollEl.textContent = formatChips(asDealer?.bank ?? mySeat?.bankroll ?? startingBalance('blackjack'));
    const { dealer } = snapshot;
    dealerNameEl.textContent =
      dealer === null ? 'Croupier' : `Croupier · ${dealer.name}${asDealer !== null ? ' (vous)' : ''} · banque ${formatChips(dealer.bank)}`;
    setHtml(dealerRoleEl, host === null ? '' : roleButton(view, dealer !== null));
    seatsEl.classList.toggle('crowded', view.seats.filter((seat) => seat !== null).length > 4);

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
    // Résultat de la banque en fin de manche : un bandeau bien visible, qui surgit à chaque nouvelle manche réglée.
    const bankResult = !closed && snapshot.notice === null && localMessage === null && dealerOf(snapshot) !== null && view.phase === 'ROUND_OVER';
    messageEl.classList.toggle('bank-result', bankResult);
    if (bankResult && bankBannerRound !== view.roundNumber) {
      bankBannerRound = view.roundNumber;
      messageEl.classList.remove('pop');
      void messageEl.offsetWidth;
      messageEl.classList.add('pop');
    }
    shoeEl.textContent = `Sabot : ${view.shoe.cardsRemaining} cartes${view.shoe.reshufflePending ? ' · remélange à la prochaine manche' : ''}`;
    setHtml(seatsEl, renderSeats(snapshot, mySeat, shared));
    const target = panel === null ? null : (view.seats.find((seat) => seat?.player.id === panel?.target)?.player.displayName ?? null);
    if (panel !== null && target === null) {
      // Le joueur visé est parti (un bot peut quitter la table entre deux manches) : le panneau se referme.
      panel = null;
      messageEl.textContent = 'Ce joueur a quitté la table.';
      messageEl.dataset['tone'] = 'error';
    }
    let controls: string;
    if (closed) controls = '<a class="btn primary" href="#/blackjack">Jouer seul</a>';
    else if (panel !== null && target !== null) controls = panel.kind === 'grant' ? grantPanelHtml(target) : renamePanelHtml(target);
    else controls = renderControls(snapshot, mySeat, shared);
    setHtml(controlsEl, controls);
    if (host !== null) saveDealerSave(host.dealerSave);
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

  /** Envoie le montant saisi au joueur visé : le panneau se referme, ses jetons arrivent tout de suite. */
  function grant(): void {
    if (panel?.kind !== 'grant') return;
    const { target } = panel;
    const input = controlsEl.querySelector<HTMLInputElement>('[data-grant-amount]');
    const amount = Math.trunc(Number(input?.value ?? ''));
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      localMessage = ['Indiquez le nombre de jetons à rendre.', 'error'];
      render();
      return;
    }
    const name = last?.view.seats.find((seat) => seat?.player.id === target)?.player.displayName ?? 'ce joueur';
    panel = null;
    send({ type: 'GRANT', target, amount });
    localMessage = [`Vous rendez ${formatChips(amount)} jetons à ${name}.`, 'win'];
    render();
  }

  /** Envoie le nouveau nom du bot visé ; un nom déjà pris revient en message d'erreur de la table. */
  function renameBot(): void {
    if (panel?.kind !== 'rename') return;
    const { target } = panel;
    const input = controlsEl.querySelector<HTMLInputElement>('[data-bot-name]');
    const name = (input?.value ?? '').replace(/\s+/g, ' ').trim();
    if (name === '') {
      localMessage = ['Indiquez un nom pour le bot.', 'error'];
      render();
      return;
    }
    const old = last?.view.seats.find((seat) => seat?.player.id === target)?.player.displayName ?? 'Le bot';
    panel = null;
    send({ type: 'RENAME_BOT', target, name });
    if (last?.notice === null) localMessage = [`${old} s'appelle maintenant ${last.view.seats.find((seat) => seat?.player.id === target)?.player.displayName ?? name}.`, 'win'];
    render();
  }

  function refill(): void {
    if (!claimDailyRefill('blackjack')) {
      localMessage = [REFILL_USED_MESSAGE, 'error'];
      render();
      return;
    }
    const seat = last === null ? null : seatOfViewer(last.view);
    const bank = last === null ? null : dealerOf(last);
    const current = bank !== null ? bank.bank : seat === null ? startingBalance('blackjack') : seat.bankroll + sum(seat.pendingBets);
    const bankroll = current + DAILY_REFILL;
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
      case 'DEALER': {
        const move = button.dataset['move'];
        if (isDealerMove(move)) send({ type: 'DEALER', action: move });
        break;
      }
      case 'DEALER_MODE':
        selectedBox = 0;
        send({ type: 'DEALER_MODE', enabled: button.dataset['enabled'] === 'true' });
        break;
      case 'NEXT_ROUND':
        send({ type: 'NEXT_ROUND' });
        break;
      case 'REBUY':
        refill();
        break;
      case 'HOUSE':
        changeHouse(button.dataset['key'], button.dataset['value']);
        break;
      case 'NEW_SERVICE':
        send({ type: 'NEW_SERVICE' });
        break;
      case 'SIDE_BET':
        send({ type: 'SIDE_BET', amount: Number(button.dataset['amount'] ?? 0) });
        break;
      case 'TIP':
        send({ type: 'TIP' });
        break;
      case 'GRANT_OPEN':
      case 'RENAME_OPEN': {
        const target = button.dataset['player'];
        panel = target === undefined ? null : { kind: action === 'GRANT_OPEN' ? 'grant' : 'rename', target };
        localMessage = null;
        render();
        const input = controlsEl.querySelector<HTMLInputElement>('[data-bot-name]');
        input?.focus();
        input?.select();
        break;
      }
      case 'RENAME_BOT':
        renameBot();
        break;
      case 'GRANT_ADD': {
        // Le montant vit dans le champ, jamais dans un rendu : le cumul des raccourcis ne peut pas être effacé.
        const input = controlsEl.querySelector<HTMLInputElement>('[data-grant-amount]');
        if (input !== null) {
          input.value = String(Math.max(0, Math.trunc(Number(input.value)) || 0) + Number(button.dataset['value'] ?? 0));
          input.focus();
        }
        break;
      }
      case 'GRANT':
        grant();
        break;
      case 'GRANT_CLOSE':
      case 'PANEL_CLOSE':
        panel = null;
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
        if (isSeatAction(action)) send({ type: action });
    }
  }

  /** Une règle de la maison change ; un minimum relevé entraîne au besoin le maximum (10 fois le minimum au moins). */
  function changeHouse(key: string | undefined, value: string | undefined): void {
    const house = last?.house;
    if (house === undefined || key === undefined || !(key in HOUSE_CHOICES)) return;
    const choices = HOUSE_CHOICES[key as keyof HouseRules] as readonly unknown[];
    const choice = choices.find((candidate) => String(candidate) === value);
    if (choice === undefined) return;
    let next = { ...house, [key]: choice } as HouseRules;
    if (next.maxBet < next.minBet * 10) next = { ...next, maxBet: HOUSE_CHOICES.maxBet.find((max) => max >= next.minBet * 10) ?? 5000 };
    send({ type: 'HOUSE_RULES', rules: next });
  }

  function onToggle(event: Event): void {
    if (event.target instanceof HTMLDetailsElement && event.target.matches('[data-house]')) houseOpen = event.target.open;
  }

  function onChange(event: Event): void {
    if (!(event.target instanceof HTMLInputElement) || !event.target.matches('[data-player-name]')) return;
    const name = savePlayerName(event.target.value);
    event.target.value = name;
    client?.send({ type: 'RENAME', name });
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.matches('[data-grant-amount], [data-bot-name]')) {
      event.preventDefault();
      if (event.target.matches('[data-bot-name]')) renameBot();
      else grant();
      return;
    }
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement) return;
    const selector =
      event.key === 'Enter'
        ? '[data-action="DEAL"], [data-action="NEXT_ROUND"], [data-action="DEALER"], [data-action="NEW_SERVICE"]'
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
      const dealerMode = host.dealerMode;
      let outcome = `Si tout le monde reste sur ses 2 cartes, le croupier ${dealerDraw(state, dealer, nextIndex + 2 * count + 2)}.`;
      if (scoreCards(dealer).isBlackjack) outcome = 'Le croupier aura Blackjack.';
      else if (mine.length === 1 && only !== undefined && scoreCards([only.first, only.second]).isBlackjack) outcome = 'Vous aurez Blackjack !';
      return [
        `Prochaines cartes du croupier : ${cardText(dealerUp)} (visible) · ${cardText(dealerHole)} (cachée)`,
        ...(dealerMode
          ? []
          : [`Mes prochaines cartes : ${mine.map((hand) => `${mine.length > 1 ? `main ${hand.box + 1} ` : ''}${cardText(hand.first)} ${cardText(hand.second)}`).join(' · ') || '—'}`]),
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
      getBalance: () => (table.dealerMode ? table.bank : (hostSeat()?.bankroll ?? 0)),
      setBalance: (_game, amount) => {
        const value = Number(amount);
        if (table.dealerMode) {
          table.setBank(value);
          return null;
        }
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
  root.addEventListener('toggle', onToggle, true);
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
    if (host !== null) saveDealerSave(host.dealerSave);
    host?.dispose();
    setCheatTarget(null);
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    root.removeEventListener('toggle', onToggle, true);
    window.removeEventListener('keydown', onKey);
  };
}
