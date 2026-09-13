import { chips, playerId, type PlayerId, type RandomSource, type SeatIndex } from '../src/core/index.js';
import {
  HoldemController,
  STANDARD_HOLDEM_RULES,
  isHandInProgress,
  type HandCategory,
  type HoldemCommand,
  type HoldemEvent,
  type HoldemRules,
  type HoldemState,
  type HoldemTableView,
  type PokerBettingActionType,
  type PokerSeat,
  type Street,
} from '../src/holdem/index.js';
import { chooseBotAction } from './holdem-bot.js';
import { DEFAULT_BALANCE } from './money-ledger.js';
import { MAX_TABLE_PLAYERS } from './net/peer-link.js';
import { cleanPlayerName } from './net/player-name.js';
import type { HostedTable } from './net/shared-table.js';
import { cardText, expectOk, formatChips } from './ui.js';

/** Cave libre et 8 sièges : chacun s'assoit avec son propre solde, qu'il soit petit ou démesuré. */
export const HOLDEM_TABLE_RULES: HoldemRules = {
  ...STANDARD_HOLDEM_RULES,
  seatCount: MAX_TABLE_PLAYERS,
  minBuyIn: STANDARD_HOLDEM_RULES.bigBlind,
  maxBuyIn: chips(Number.MAX_SAFE_INTEGER),
};

/** Créateur de la table ; les invités reçoivent « invite-1 », « invite-2 »…, les bots « bot-<siège> ». */
export const HOLDEM_HOST: PlayerId = playerId('hote');

export const CATEGORY_LABELS: Record<HandCategory, string> = {
  HIGH_CARD: 'Hauteur',
  ONE_PAIR: 'Paire',
  TWO_PAIR: 'Double paire',
  THREE_OF_A_KIND: 'Brelan',
  STRAIGHT: 'Quinte',
  FLUSH: 'Couleur',
  FULL_HOUSE: 'Full',
  FOUR_OF_A_KIND: 'Carré',
  STRAIGHT_FLUSH: 'Quinte flush',
};

export const STREET_LABELS: Record<Exclude<Street, 'PREFLOP'>, string> = { FLOP: 'Flop', TURN: 'Turn', RIVER: 'River' };

const ACTION_LOG: Record<PokerBettingActionType, string> = {
  FOLD: 'se couche',
  CHECK: 'checke',
  CALL: 'suit',
  BET: 'mise',
  RAISE: 'relance à',
  ALL_IN: 'fait tapis à',
};

const BOT_NAMES = ['Léa', 'Hugo', 'Nora', 'Malik', 'Inès', 'Sacha', 'Yanis'] as const;
/** Les bots complètent la table jusqu'à 6 joueurs et cèdent leur siège aux vrais joueurs. */
const TARGET_PLAYERS = 6;
/** Ordre de remplissage des sièges : les joueurs se répartissent autour de la table plutôt que d'un seul côté. */
const SEAT_ORDER: readonly SeatIndex[] = [0, 4, 2, 6, 3, 5, 1, 7];
const BOT_DELAY_MS = 850;
const ABSENT_DELAY_MS = 400;
const LOG_SIZE = 60;

const BETTING_ACTIONS = ['FOLD', 'CHECK', 'CALL', 'ALL_IN'] as const;
type SimpleBettingAction = (typeof BETTING_ACTIONS)[number];
export const isSimpleBettingAction = (value: unknown): value is SimpleBettingAction =>
  (BETTING_ACTIONS as readonly unknown[]).includes(value);

/** Ce qu'un joueur envoie à la table : jamais son identifiant, que la table déduit de sa connexion. */
export type HoldemTableCommand =
  | { readonly type: SimpleBettingAction }
  | { readonly type: 'BET'; readonly amount: number }
  | { readonly type: 'RAISE'; readonly raiseTo: number }
  | { readonly type: 'NEXT_HAND' }
  /** Nouveau tapis après la recharge du jour, appliqué entre deux mains. */
  | { readonly type: 'REBUY'; readonly bankroll: number }
  | { readonly type: 'RENAME'; readonly name: string };

export interface HoldemSnapshot {
  readonly view: HoldemTableView;
  readonly me: PlayerId;
  readonly log: readonly string[];
  readonly notice: string | null;
  /** Pseudos des joueurs arrivés en pleine main, assis à la suivante. */
  readonly waiting: readonly string[];
  /** Joueurs réels (assis ou en attente), créateur compris. */
  readonly players: number;
}

const isBot = (id: PlayerId): boolean => id.startsWith('bot-');

function parseCommand(raw: unknown): HoldemTableCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { type, amount, raiseTo, bankroll, name } = raw as Record<string, unknown>;
  if (isSimpleBettingAction(type)) return { type };
  switch (type) {
    case 'BET':
      return typeof amount === 'number' ? { type: 'BET', amount } : null;
    case 'RAISE':
      return typeof raiseTo === 'number' ? { type: 'RAISE', raiseTo } : null;
    case 'NEXT_HAND':
      return { type: 'NEXT_HAND' };
    case 'REBUY':
      return typeof bankroll === 'number' ? { type: 'REBUY', bankroll } : null;
    case 'RENAME':
      return typeof name === 'string' ? { type: 'RENAME', name } : null;
    default:
      return null;
  }
}

/**
 * Table de Texas Hold'em côté créateur, en solo comme en partage : seule détentrice du paquet et des cartes privées,
 * elle fait jouer les bots, se couche à la place des absents et n'envoie à chacun que sa projection anti-triche.
 */
export class HoldemTable implements HostedTable<HoldemSnapshot, HoldemTableCommand> {
  readonly #engine: HoldemController;
  readonly #rng: RandomSource;
  #state: HoldemState;
  #log: readonly string[] = [];
  readonly #notices = new Map<PlayerId, string>();
  readonly #names = new Map<PlayerId, string>();
  readonly #queue = new Map<PlayerId, { readonly name: string; readonly bankroll: number }>();
  readonly #leaving = new Set<PlayerId>();
  readonly #listeners = new Set<() => void>();
  #timer: number | undefined;
  #guests = 0;

  constructor(engine: HoldemController, rng: RandomSource, hostName: string, hostBankroll: number) {
    this.#engine = engine;
    this.#rng = rng;
    this.#state = expectOk(engine.createTable(HOLDEM_TABLE_RULES));
    this.#names.set(HOLDEM_HOST, hostName);
    if (hostBankroll >= HOLDEM_TABLE_RULES.minBuyIn) this.#sitAt(0, HOLDEM_HOST, hostName, hostBankroll);
    this.#balanceBots();
  }

  get state(): HoldemState {
    return this.#state;
  }

  /** Codes de triche du créateur : remplace l'état puis prévient tous les joueurs. */
  replaceState(next: HoldemState): void {
    this.#state = next;
    this.#changed();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    window.clearTimeout(this.#timer);
    this.#listeners.clear();
  }

  join(name: string, bankroll: number): { readonly playerId: PlayerId } | { readonly error: string } {
    if (this.#humanCount() >= MAX_TABLE_PLAYERS) return { error: `Table complète : ${MAX_TABLE_PLAYERS} joueurs maximum.` };
    const { minBuyIn } = this.#state.rules;
    if (!Number.isSafeInteger(bankroll) || bankroll < minBuyIn) {
      return { error: `Il faut au moins ${formatChips(minBuyIn)} jetons de Hold'em pour s'asseoir.` };
    }
    this.#guests += 1;
    const id = playerId(`invite-${this.#guests}`);
    const clean = cleanPlayerName(name);
    this.#names.set(id, clean);
    this.#queue.set(id, { name: clean, bankroll });
    this.#pushLog(`${clean} rejoint la table.`);
    this.#seatQueued();
    this.#changed();
    return { playerId: id };
  }

  leave(id: PlayerId): void {
    this.#queue.delete(id);
    this.#notices.delete(id);
    const seat = this.#seatOf(id);
    if (seat !== null) {
      this.#leaving.add(id);
      this.#pushLog(`${seat.player.displayName} quitte la table.`);
    }
    this.#removeLeavers();
    this.#schedule();
    this.#changed();
  }

  command(id: PlayerId, raw: unknown): void {
    const command = parseCommand(raw);
    this.#notices.delete(id);
    if (command === null) this.#notices.set(id, 'Commande inconnue.');
    else if (!this.#leaving.has(id)) this.#run(id, command);
    this.#changed();
  }

  snapshotFor(id: PlayerId): HoldemSnapshot {
    return {
      view: this.#engine.project(this.#state, id),
      me: id,
      log: this.#log,
      notice: this.#notices.get(id) ?? null,
      waiting: [...this.#queue.values()].map((guest) => guest.name),
      players: this.#humanCount(),
    };
  }

  #run(id: PlayerId, command: HoldemTableCommand): void {
    switch (command.type) {
      case 'NEXT_HAND':
        this.#startHand();
        return;
      case 'REBUY':
        this.#rebuy(id, command.bankroll);
        return;
      case 'RENAME':
        this.#rename(id, cleanPlayerName(command.name));
        return;
      case 'BET':
        if (Number.isSafeInteger(command.amount) && command.amount > 0) this.#act(id, { type: 'BET', playerId: id, amount: chips(command.amount) });
        else this.#notices.set(id, 'Mise invalide.');
        return;
      case 'RAISE':
        if (Number.isSafeInteger(command.raiseTo) && command.raiseTo > 0) this.#act(id, { type: 'RAISE', playerId: id, raiseTo: chips(command.raiseTo) });
        else this.#notices.set(id, 'Relance invalide.');
        return;
      default:
        this.#act(id, { type: command.type, playerId: id });
    }
  }

  /** Nouvelle main : départs, arrivées, bots, puis donne. Sans vrai joueur assis avec des jetons, la table attend. */
  #startHand(): void {
    if (isHandInProgress(this.#state)) return;
    this.#removeLeavers();
    this.#seatQueued();
    this.#balanceBots();
    const humanWithChips = this.#state.seats.some((seat) => seat !== null && !isBot(seat.player.id) && seat.stack > 0);
    if (humanWithChips) this.#act(null, { type: 'START_HAND' });
  }

  /** Applique une commande au moteur et journalise ses événements ; un refus devient le message du joueur concerné. */
  #apply(id: PlayerId | null, command: HoldemCommand): boolean {
    const result = this.#engine.apply(this.#state, command);
    if (!result.ok) {
      if (id !== null) this.#notices.set(id, result.error.message);
      return false;
    }
    this.#state = result.value.state;
    for (const event of result.value.events) {
      const line = this.#describe(event);
      if (line !== null) this.#pushLog(line);
    }
    return true;
  }

  #act(id: PlayerId | null, command: HoldemCommand): void {
    const wasInHand = isHandInProgress(this.#state);
    if (!this.#apply(id, command)) return;
    if (wasInHand && !isHandInProgress(this.#state)) {
      this.#removeLeavers();
      this.#seatQueued();
    }
    this.#schedule();
  }

  /** Programme le coup d'un bot, ou le « check sinon couché » d'un joueur parti, quand c'est à eux de parler. */
  #schedule(): void {
    window.clearTimeout(this.#timer);
    const state = this.#state;
    if (!isHandInProgress(state)) return;
    const actor = state.seats[state.betting.toAct];
    if (actor === null || actor === undefined) return;
    const id = actor.player.id;
    if (!isBot(id) && !this.#leaving.has(id)) return;

    this.#timer = window.setTimeout(
      () => {
        const current = this.#state;
        if (!isHandInProgress(current)) return;
        const seat = current.seats[current.betting.toAct];
        if (seat === null || seat === undefined || seat.player.id !== id) return;
        const legal = this.#engine.legalActions(current, id);
        if (legal === null) return;
        const command: HoldemCommand = isBot(id)
          ? chooseBotAction(current, seat, legal, this.#rng)
          : { type: legal.canCheck ? 'CHECK' : 'FOLD', playerId: id };
        this.#act(null, command);
        this.#changed();
      },
      isBot(id) ? BOT_DELAY_MS : ABSENT_DELAY_MS,
    );
  }

  #removeLeavers(): void {
    if (isHandInProgress(this.#state)) return;
    for (const id of [...this.#leaving]) {
      this.#leaving.delete(id);
      if (this.#seatOf(id) !== null) this.#apply(null, { type: 'LEAVE_SEAT', playerId: id });
    }
  }

  /** Assoit les joueurs en attente entre deux mains, en libérant au besoin le siège d'un bot. */
  #seatQueued(): void {
    if (isHandInProgress(this.#state)) return;
    for (const [id, guest] of [...this.#queue]) {
      let seatIndex = this.#freeSeat();
      if (seatIndex === null) {
        const bot = [...this.#state.seats].reverse().find((seat) => seat !== null && isBot(seat.player.id));
        if (bot === null || bot === undefined) return;
        this.#apply(null, { type: 'LEAVE_SEAT', playerId: bot.player.id });
        seatIndex = bot.seatIndex;
      }
      this.#queue.delete(id);
      if (this.#sitAt(seatIndex, id, guest.name, guest.bankroll)) this.#pushLog(`${guest.name} s'assoit avec ${formatChips(guest.bankroll)} jetons.`);
    }
  }

  /** Recave les bots ruinés, puis ajuste leur nombre : 6 joueurs autour de la table tant qu'il y a moins de 6 vrais joueurs. */
  #balanceBots(): void {
    if (isHandInProgress(this.#state)) return;
    for (const seat of this.#state.seats) {
      if (seat === null || !isBot(seat.player.id) || seat.stack > 0) continue;
      this.#apply(null, { type: 'LEAVE_SEAT', playerId: seat.player.id });
      this.#sitAt(seat.seatIndex, seat.player.id, seat.player.displayName, DEFAULT_BALANCE);
      this.#pushLog(`${seat.player.displayName} recave ${formatChips(DEFAULT_BALANCE)} jetons.`);
    }

    const humans = this.#state.seats.filter((seat) => seat !== null && !isBot(seat.player.id)).length + this.#queue.size;
    const bots = this.#state.seats.filter((seat): seat is PokerSeat => seat !== null && isBot(seat.player.id));
    const wanted = Math.max(0, TARGET_PLAYERS - humans);
    for (const bot of bots.slice(wanted)) this.#apply(null, { type: 'LEAVE_SEAT', playerId: bot.player.id });
    for (let missing = wanted - bots.length; missing > 0; missing -= 1) {
      const seatIndex = this.#freeSeat();
      if (seatIndex === null) return;
      const taken = new Set(this.#state.seats.map((seat) => seat?.player.displayName));
      const name = BOT_NAMES.find((candidate) => !taken.has(candidate)) ?? `Bot ${seatIndex + 1}`;
      this.#sitAt(seatIndex, playerId(`bot-${seatIndex}`), name, DEFAULT_BALANCE);
    }
  }

  /** Recharge du jour : le joueur se rassoit à sa place (ou dès qu'une place se libère) avec son nouveau tapis. */
  #rebuy(id: PlayerId, bankroll: number): void {
    if (!Number.isSafeInteger(bankroll) || bankroll < this.#state.rules.minBuyIn) {
      this.#notices.set(id, 'Tapis invalide.');
      return;
    }
    const queued = this.#queue.get(id);
    if (queued !== undefined) {
      this.#queue.set(id, { ...queued, bankroll });
      return;
    }
    if (isHandInProgress(this.#state)) {
      this.#notices.set(id, 'La recharge s’applique entre deux mains.');
      return;
    }
    const seat = this.#seatOf(id);
    const name = this.#names.get(id) ?? seat?.player.displayName ?? cleanPlayerName(null);
    if (seat !== null) {
      if (this.#apply(id, { type: 'LEAVE_SEAT', playerId: id })) this.#sitAt(seat.seatIndex, id, name, bankroll);
      return;
    }
    this.#queue.set(id, { name, bankroll });
    this.#seatQueued();
  }

  #rename(id: PlayerId, name: string): void {
    this.#names.set(id, name);
    const queued = this.#queue.get(id);
    if (queued !== undefined) this.#queue.set(id, { ...queued, name });
    const seat = this.#seatOf(id);
    if (seat === null) return;
    const renamed: PokerSeat = { ...seat, player: { ...seat.player, displayName: name } };
    this.#state = { ...this.#state, seats: this.#state.seats.map((current) => (current === seat ? renamed : current)) };
  }

  #sitAt(seatIndex: SeatIndex, id: PlayerId, name: string, bankroll: number): boolean {
    return this.#apply(id, { type: 'SIT_DOWN', playerId: id, seatIndex, displayName: name, buyIn: chips(bankroll) });
  }

  #freeSeat(): SeatIndex | null {
    return SEAT_ORDER.find((index) => this.#state.seats[index] === null) ?? null;
  }

  #seatOf(id: PlayerId): PokerSeat | null {
    return this.#state.seats.find((seat) => seat?.player.id === id) ?? null;
  }

  #humanCount(): number {
    const seated = this.#state.seats.filter((seat) => seat !== null && !isBot(seat.player.id) && !this.#leaving.has(seat.player.id)).length;
    return seated + this.#queue.size;
  }

  #pushLog(line: string): void {
    this.#log = [...this.#log, line].slice(-LOG_SIZE);
  }

  #changed(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  #nameOf(seatIndex: SeatIndex): string {
    return this.#state.seats[seatIndex]?.player.displayName ?? `Siège ${seatIndex + 1}`;
  }

  #describe(event: HoldemEvent): string | null {
    switch (event.type) {
      case 'HAND_STARTED':
        return `— Main n°${event.handNumber} · bouton : ${this.#nameOf(event.buttonSeat)}`;
      case 'FORCED_BET_POSTED':
        if (event.kind === 'ANTE') return null;
        return `${this.#nameOf(event.seatIndex)} poste la ${event.kind === 'SMALL_BLIND' ? 'petite' : 'grosse'} blinde (${formatChips(event.amount)})`;
      case 'PLAYER_ACTED': {
        const amount = event.action === 'CALL' ? event.amount : event.streetBet;
        const suffix = event.action === 'FOLD' || event.action === 'CHECK' ? '' : ` ${formatChips(amount)}`;
        return `${this.#nameOf(event.seatIndex)} ${ACTION_LOG[event.action]}${suffix}`;
      }
      case 'STREET_DEALT':
        return `${STREET_LABELS[event.street]} : ${event.cards.map(cardText).join(' ')}`;
      case 'UNCALLED_BET_RETURNED':
        return `${formatChips(event.amount)} non suivis rendus à ${this.#nameOf(event.seatIndex)}`;
      case 'POT_AWARDED': {
        const hand = event.award.winningHand;
        const potName = event.award.potIndex === 0 ? 'le pot principal' : `le side pot n°${event.award.potIndex}`;
        return event.award.shares
          .map((share) => `${this.#nameOf(share.seatIndex)} remporte ${formatChips(share.amount)} (${potName}${hand ? `, ${CATEGORY_LABELS[hand.category]}` : ''})`)
          .join(' · ');
      }
      default:
        return null;
    }
  }
}
