import { chips, playerId, type PlayerId, type RandomSource } from '../src/core/index.js';
import {
  BlackjackController,
  STANDARD_BLACKJACK_RULES,
  type BlackjackCommand,
  type BlackjackDealerAction,
  type BlackjackRules,
  type BlackjackSeat,
  type BlackjackState,
  type BlackjackTableView,
} from '../src/blackjack/index.js';
import { chooseBotBet, chooseBotMove } from './blackjack-bot.js';
import { DEFAULT_BALANCE } from './money-ledger.js';
import { MAX_TABLE_PLAYERS } from './net/peer-link.js';
import { cleanPlayerName } from './net/player-name.js';
import type { HostedTable } from './net/shared-table.js';
import { expectOk, formatChips } from './ui.js';

/** 8 places : un joueur seul peut y jouer jusqu'à 8 mains, huit joueurs une main chacun. */
export const BLACKJACK_TABLE_RULES: BlackjackRules = { ...STANDARD_BLACKJACK_RULES, seatCount: MAX_TABLE_PLAYERS };

/** Créateur de la table ; les invités reçoivent « invite-1 », « invite-2 »…, les bots « bot-<place> ». */
export const BLACKJACK_HOST: PlayerId = playerId('hote');

const BOT_NAMES = ['Léa', 'Hugo', 'Nora', 'Malik', 'Inès', 'Sacha', 'Yanis', 'Zoé'] as const;
const BOT_DELAY_MS = 700;
/** Plafond d'un crédit offert par le créateur, comme pour les codes de triche. */
const MAX_GRANT = 1_000_000_000_000;

/** Les bots n'existent qu'à la table d'un croupier humain : ils prennent chaque place laissée libre par les vrais joueurs. */
export const isBotPlayer = (id: string): boolean => id.startsWith('bot-');

const SEAT_ACTIONS = ['CLEAR_BET', 'TAKE_INSURANCE', 'DECLINE_INSURANCE', 'HIT', 'STAND', 'DOUBLE_DOWN', 'SPLIT', 'SURRENDER'] as const;
export type BlackjackSeatAction = (typeof SEAT_ACTIONS)[number];
export const isSeatAction = (value: unknown): value is BlackjackSeatAction => (SEAT_ACTIONS as readonly unknown[]).includes(value);

const DEALER_MOVES = ['DEAL', 'REVEAL_HOLE_CARD', 'DEALER_HIT', 'DEALER_STAND'] as const;
export type BlackjackDealerMove = 'DEAL' | BlackjackDealerAction;
export const isDealerMove = (value: unknown): value is BlackjackDealerMove => (DEALER_MOVES as readonly unknown[]).includes(value);

/** Ce qu'un joueur envoie à la table : jamais son identifiant, que la table déduit de sa connexion. */
export type BlackjackTableCommand =
  | { readonly type: BlackjackSeatAction }
  | { readonly type: 'PLACE_BET'; readonly amount: number; readonly box: number }
  /** Prêt pour la donne : sans croupier humain, les cartes partent quand tous les joueurs pouvant miser sont prêts. */
  | { readonly type: 'READY' }
  | { readonly type: 'NEXT_ROUND' }
  /** Nouveau solde après la recharge du jour (la banque, pour le croupier), appliqué entre deux manches. */
  | { readonly type: 'REBUY'; readonly bankroll: number }
  | { readonly type: 'RENAME'; readonly name: string }
  /** Créateur uniquement, entre deux manches : devenir croupier face aux bots et aux invités, ou redevenir joueur. */
  | { readonly type: 'DEALER_MODE'; readonly enabled: boolean }
  /** Créateur croupier uniquement : distribuer, retourner la carte cachée, tirer, s'arrêter. */
  | { readonly type: 'DEALER'; readonly action: BlackjackDealerMove }
  /** Créateur uniquement : rendre des jetons à un joueur qui a rejoint la table, sans toucher à sa banque. */
  | { readonly type: 'GRANT'; readonly target: string; readonly amount: number };

export interface BlackjackDealerInfo {
  readonly name: string;
  /** Banque du croupier : elle encaisse les mises perdues et paie les gains des joueurs. */
  readonly bank: number;
  /** Variation de la banque sur la dernière manche réglée. */
  readonly lastRound: { readonly roundNumber: number; readonly net: number } | null;
}

export interface BlackjackSnapshot {
  readonly view: BlackjackTableView;
  readonly me: PlayerId;
  readonly ready: readonly PlayerId[];
  /** Pseudos des invités arrivés en pleine manche, assis dès la suivante. */
  readonly waiting: readonly string[];
  /** Dernière commande refusée à ce joueur. */
  readonly notice: string | null;
  /** Joueurs réels à la table (assis ou en attente), créateur compris quand il joue. */
  readonly players: number;
  /** Présent quand le créateur tient le rôle de croupier. */
  readonly dealer: BlackjackDealerInfo | null;
  /** Total des jetons rendus par le créateur à ce joueur : sa hausse prévient le joueur crédité. */
  readonly credited: number;
}

function parseCommand(raw: unknown): BlackjackTableCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { type, amount, box, bankroll, name, enabled, action, target } = raw as Record<string, unknown>;
  if (isSeatAction(type)) return { type };
  switch (type) {
    case 'PLACE_BET':
      return typeof amount === 'number' && typeof box === 'number' ? { type: 'PLACE_BET', amount, box } : null;
    case 'READY':
      return { type: 'READY' };
    case 'NEXT_ROUND':
      return { type: 'NEXT_ROUND' };
    case 'REBUY':
      return typeof bankroll === 'number' ? { type: 'REBUY', bankroll } : null;
    case 'RENAME':
      return typeof name === 'string' ? { type: 'RENAME', name } : null;
    case 'DEALER_MODE':
      return typeof enabled === 'boolean' ? { type: 'DEALER_MODE', enabled } : null;
    case 'DEALER':
      return isDealerMove(action) ? { type: 'DEALER', action } : null;
    case 'GRANT':
      return typeof target === 'string' && typeof amount === 'number' ? { type: 'GRANT', target, amount } : null;
    default:
      return null;
  }
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/** Un joueur qui peut encore miser doit confirmer « Prêt » (ou passer) avant la donne. */
const canBet = (seat: BlackjackSeat, rules: BlackjackRules): boolean => seat.bankroll + sum(seat.pendingBets) >= rules.minBet;

/**
 * Table de Blackjack côté créateur, en solo comme en partage : seule détentrice de l'état (donc du sabot), elle valide
 * chaque commande avec le moteur, fait jouer les bots et les absents, et n'expose à chaque joueur que sa projection.
 * Quand le créateur devient croupier, sa banque remplace son siège et les bots occupent les places libres.
 */
export class BlackjackTable implements HostedTable<BlackjackSnapshot, BlackjackTableCommand> {
  readonly #engine: BlackjackController;
  readonly #rng: RandomSource;
  #state: BlackjackState;
  readonly #ready = new Set<PlayerId>();
  readonly #notices = new Map<PlayerId, string>();
  readonly #names = new Map<PlayerId, string>();
  /** Invités arrivés en pleine manche (ou faute de place) : assis dès que possible. */
  readonly #queue = new Map<PlayerId, { readonly name: string; readonly bankroll: number }>();
  /** Joueurs partis : ils restent sur leurs mains jusqu'au règlement, puis quittent la table. */
  readonly #leaving = new Set<PlayerId>();
  /** Jetons rendus par le créateur, cumulés par joueur. */
  readonly #credits = new Map<PlayerId, number>();
  readonly #listeners = new Set<() => void>();
  #guests = 0;
  #dealerMode = false;
  #bank = 0;
  #lastRound: BlackjackDealerInfo['lastRound'] = null;
  #timer: number | undefined;

  constructor(engine: BlackjackController, rng: RandomSource, hostName: string, hostBankroll: number) {
    this.#engine = engine;
    this.#rng = rng;
    this.#state = expectOk(engine.createTable(BLACKJACK_TABLE_RULES));
    this.#names.set(BLACKJACK_HOST, hostName);
    if (hostBankroll > 0) this.#sit(BLACKJACK_HOST, hostName, hostBankroll);
  }

  get state(): BlackjackState {
    return this.#state;
  }

  get dealerMode(): boolean {
    return this.#dealerMode;
  }

  get bank(): number {
    return this.#bank;
  }

  /** Codes de triche du créateur : remplace l'état puis prévient tous les joueurs. */
  replaceState(next: BlackjackState): void {
    this.#state = next;
    this.#settle();
  }

  /** Code de triche du créateur croupier : fixe la banque. */
  setBank(amount: number): void {
    this.#bank = Math.max(0, amount);
    this.#settle();
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
    if (this.#playerCount() >= MAX_TABLE_PLAYERS) return { error: `Table complète : ${MAX_TABLE_PLAYERS} joueurs maximum.` };
    const { minBet } = this.#state.rules;
    if (!Number.isSafeInteger(bankroll) || bankroll < minBet) {
      return { error: `Il faut au moins ${formatChips(minBet)} jetons de Blackjack pour s'asseoir.` };
    }
    this.#guests += 1;
    const id = playerId(`invite-${this.#guests}`);
    const clean = cleanPlayerName(name);
    this.#names.set(id, clean);
    this.#queue.set(id, { name: clean, bankroll });
    this.#settle();
    return { playerId: id };
  }

  leave(id: PlayerId): void {
    this.#queue.delete(id);
    this.#ready.delete(id);
    this.#notices.delete(id);
    this.#credits.delete(id);
    if (this.#seatOf(id) !== null) this.#leaving.add(id);
    this.#settle();
  }

  command(id: PlayerId, raw: unknown): void {
    const command = parseCommand(raw);
    this.#notices.delete(id);
    if (command === null) this.#notices.set(id, 'Commande inconnue.');
    else if (!this.#leaving.has(id)) this.#run(id, command);
    this.#settle();
  }

  snapshotFor(id: PlayerId): BlackjackSnapshot {
    return {
      view: this.#engine.project(this.#state, id),
      me: id,
      ready: [...this.#ready],
      waiting: [...this.#queue.values()].map((guest) => guest.name),
      notice: this.#notices.get(id) ?? null,
      players: this.#playerCount(),
      dealer: this.#dealerMode
        ? { name: this.#names.get(BLACKJACK_HOST) ?? cleanPlayerName(null), bank: this.#bank, lastRound: this.#lastRound }
        : null,
      credited: this.#credits.get(id) ?? 0,
    };
  }

  #run(id: PlayerId, command: BlackjackTableCommand): void {
    const host = id === BLACKJACK_HOST;
    switch (command.type) {
      case 'READY':
        if (this.#seatOf(id) !== null) this.#ready.add(id);
        return;
      case 'NEXT_ROUND':
        if (this.#dealerMode && !host) this.#notices.set(id, 'Le croupier lance la manche suivante.');
        else this.#apply(id, { type: 'NEXT_ROUND' });
        return;
      case 'PLACE_BET':
        if (!Number.isSafeInteger(command.amount) || command.amount <= 0) {
          this.#notices.set(id, 'Mise invalide.');
          return;
        }
        this.#apply(id, { type: 'PLACE_BET', playerId: id, amount: chips(command.amount), box: command.box });
        return;
      case 'REBUY':
        if (host && this.#dealerMode) {
          if (Number.isSafeInteger(command.bankroll) && command.bankroll > 0) this.#bank = command.bankroll;
          else this.#notices.set(id, 'Banque invalide.');
        } else {
          this.#rebuy(id, command.bankroll);
        }
        return;
      case 'RENAME':
        this.#rename(id, cleanPlayerName(command.name));
        return;
      case 'DEALER_MODE':
        if (host) this.#setDealerMode(command.enabled);
        else this.#notices.set(id, 'Seul le créateur de la table peut devenir croupier.');
        return;
      case 'DEALER':
        if (!host || !this.#dealerMode) this.#notices.set(id, 'Seul le croupier joue ce coup.');
        else if (command.action === 'DEAL') this.#dealerDeal();
        else this.#apply(id, { type: command.action });
        return;
      case 'GRANT':
        if (host) this.#grant(playerId(command.target), command.amount);
        else this.#notices.set(id, 'Seul le créateur de la table rend des jetons.');
        return;
      default:
        this.#apply(id, { type: command.type, playerId: id });
    }
  }

  /** Applique une commande au moteur ; un refus devient le message du joueur concerné. */
  #apply(id: PlayerId | null, command: BlackjackCommand): boolean {
    const result = this.#engine.apply(this.#state, command);
    if (!result.ok) {
      if (id !== null) this.#notices.set(id, result.error.message);
      return false;
    }
    const wasOver = this.#state.phase === 'ROUND_OVER';
    this.#state = result.value.state;
    if (this.#dealerMode && !wasOver && this.#state.phase === 'ROUND_OVER') this.#settleBank();
    return true;
  }

  /** La banque encaisse ce que les joueurs perdent et paie ce qu'ils gagnent ; elle ne descend jamais sous zéro. */
  #settleBank(): void {
    const state = this.#state;
    if (state.phase !== 'ROUND_OVER') return;
    const players =
      sum(state.settlements.map((settlement) => settlement.returned - settlement.stake)) +
      sum(state.insuranceSettlements.map((settlement) => settlement.returned - settlement.stake));
    const bank = Math.max(0, this.#bank - players);
    this.#lastRound = { roundNumber: state.roundNumber, net: bank - this.#bank };
    this.#bank = bank;
  }

  #dealerDeal(): void {
    if (this.#bank <= 0) {
      this.#notices.set(BLACKJACK_HOST, 'La banque est vide : rechargez-la pour distribuer.');
      return;
    }
    if (this.#apply(BLACKJACK_HOST, { type: 'DEAL' })) this.#ready.clear();
  }

  /** Changement de rôle du créateur, entre deux manches : son solde devient la banque, ou la banque redevient son solde. */
  #setDealerMode(enabled: boolean): void {
    if (enabled === this.#dealerMode) return;
    const { phase } = this.#state;
    if (phase !== 'BETTING' && phase !== 'ROUND_OVER') {
      this.#notices.set(BLACKJACK_HOST, 'Le changement de rôle se fait entre deux manches.');
      return;
    }
    if (enabled) {
      const seat = this.#seatOf(BLACKJACK_HOST);
      this.#bank = seat === null ? 0 : seat.bankroll + sum(seat.pendingBets);
      this.#lastRound = null;
      if (seat !== null) this.#apply(null, { type: 'LEAVE_SEAT', playerId: BLACKJACK_HOST });
    } else {
      for (const seat of this.#state.seats) {
        if (seat !== null && isBotPlayer(seat.player.id)) this.#apply(null, { type: 'LEAVE_SEAT', playerId: seat.player.id });
      }
      if (this.#bank > 0) this.#sit(BLACKJACK_HOST, this.#names.get(BLACKJACK_HOST) ?? cleanPlayerName(null), this.#bank);
      this.#bank = 0;
      this.#lastRound = null;
    }
    this.#dealerMode = enabled;
    this.#state = { ...this.#state, rules: { ...this.#state.rules, dealerPlay: enabled ? 'MANUAL' : 'AUTO' } };
    this.#ready.clear();
  }

  #sit(id: PlayerId, name: string, bankroll: number, seatIndex = this.#state.seats.indexOf(null)): boolean {
    if (seatIndex === -1) return false;
    return this.#apply(id, { type: 'SIT_DOWN', playerId: id, seatIndex, displayName: name, buyIn: chips(bankroll) });
  }

  /** Recharge du jour : le joueur se rassoit à sa place (ou à la première libre) avec son nouveau solde. */
  #rebuy(id: PlayerId, bankroll: number): void {
    const { phase } = this.#state;
    if (!Number.isSafeInteger(bankroll) || bankroll <= 0) {
      this.#notices.set(id, 'Solde invalide.');
      return;
    }
    const queued = this.#queue.get(id);
    if (queued !== undefined) {
      this.#queue.set(id, { ...queued, bankroll });
      return;
    }
    if (phase !== 'BETTING' && phase !== 'ROUND_OVER') {
      this.#notices.set(id, 'La recharge s’applique entre deux manches.');
      return;
    }
    const seat = this.#seatOf(id);
    const name = this.#names.get(id) ?? seat?.player.displayName ?? cleanPlayerName(null);
    if (seat === null) {
      if (!this.#sit(id, name, bankroll)) this.#notices.set(id, 'Aucune place libre pour le moment.');
      return;
    }
    if (this.#apply(id, { type: 'LEAVE_SEAT', playerId: id })) this.#sit(id, name, bankroll, seat.seatIndex);
  }

  /**
   * Le créateur rend des jetons à un joueur qui a rejoint la table : crédités aussitôt, à son siège comme dans la file
   * d'attente. Ce sont des jetons fictifs offerts par la maison, donc la banque du croupier n'est pas débitée.
   */
  #grant(target: PlayerId, amount: number): void {
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_GRANT) {
      this.#notices.set(BLACKJACK_HOST, `Montant invalide : de 1 à ${formatChips(MAX_GRANT)} jetons.`);
      return;
    }
    if (target === BLACKJACK_HOST || isBotPlayer(target)) {
      this.#notices.set(BLACKJACK_HOST, 'Seuls les joueurs qui ont rejoint la table peuvent être crédités.');
      return;
    }
    const queued = this.#queue.get(target);
    const seat = this.#seatOf(target);
    if (queued === undefined && seat === null) {
      this.#notices.set(BLACKJACK_HOST, 'Ce joueur a quitté la table.');
      return;
    }
    if (queued !== undefined) this.#queue.set(target, { ...queued, bankroll: Math.min(queued.bankroll + amount, MAX_GRANT) });
    if (seat !== null) {
      const credited: BlackjackSeat = { ...seat, bankroll: chips(Math.min(seat.bankroll + amount, MAX_GRANT)) };
      this.#state = { ...this.#state, seats: this.#state.seats.map((current) => (current === seat ? credited : current)) };
    }
    this.#credits.set(target, (this.#credits.get(target) ?? 0) + amount);
  }

  #rename(id: PlayerId, name: string): void {
    this.#names.set(id, name);
    const queued = this.#queue.get(id);
    if (queued !== undefined) this.#queue.set(id, { ...queued, name });
    const seat = this.#seatOf(id);
    if (seat === null) return;
    const renamed: BlackjackSeat = { ...seat, player: { ...seat.player, displayName: name } };
    this.#state = { ...this.#state, seats: this.#state.seats.map((current) => (current === seat ? renamed : current)) };
  }

  #seatOf(id: PlayerId): BlackjackSeat | null {
    return this.#state.seats.find((seat) => seat?.player.id === id) ?? null;
  }

  #playerCount(): number {
    const seated = this.#state.seats.filter(
      (seat) => seat !== null && !isBotPlayer(seat.player.id) && !this.#leaving.has(seat.player.id),
    ).length;
    return seated + this.#queue.size;
  }

  /** Enchaîne les étapes automatiques (départs, arrivées, bots, donne, jeu des absents), puis prévient les joueurs. */
  #settle(): void {
    for (let guard = 0; guard < 200 && this.#step(); guard += 1) {
      // Chaque étape modifie l'état : on recommence jusqu'à stabilité.
    }
    for (const listener of [...this.#listeners]) listener();
    this.#scheduleBot();
  }

  #step(): boolean {
    const state = this.#state;
    const betweenRounds = state.phase === 'BETTING' || state.phase === 'ROUND_OVER';

    for (const id of this.#leaving) {
      if (this.#seatOf(id) === null) {
        this.#leaving.delete(id);
        return true;
      }
      if (betweenRounds) {
        this.#leaving.delete(id);
        this.#ready.delete(id);
        this.#apply(null, { type: 'LEAVE_SEAT', playerId: id });
        return true;
      }
      // Parti en pleine manche : il reste sur toutes ses mains et décline l'assurance.
      const { actions } = this.#engine.legalActions(state, id);
      if (actions.includes('DECLINE_INSURANCE')) return this.#apply(null, { type: 'DECLINE_INSURANCE', playerId: id });
      if (actions.includes('STAND')) return this.#apply(null, { type: 'STAND', playerId: id });
    }

    const next = this.#queue.entries().next();
    if (betweenRounds && !next.done && state.seats.includes(null) && this.#engine.project(state, null).freePlaces >= 1) {
      const [id, guest] = next.value;
      this.#queue.delete(id);
      this.#sit(id, guest.name, guest.bankroll);
      return true;
    }

    // Table d'un croupier humain : c'est lui qui distribue, les bots misent et déclinent l'assurance d'eux-mêmes.
    if (this.#dealerMode) return this.#botStep(state, betweenRounds);

    if (state.phase === 'BETTING' && this.#ready.size > 0) {
      const players = state.seats.filter(
        (seat): seat is BlackjackSeat => seat !== null && canBet(seat, state.rules) && !this.#leaving.has(seat.player.id),
      );
      if (players.every((seat) => this.#ready.has(seat.player.id))) {
        this.#ready.clear();
        if (players.some((seat) => seat.pendingBets.length > 0)) this.#apply(null, { type: 'DEAL' });
        return true;
      }
    }
    return false;
  }

  /** Bots de la table du croupier : recave, place cédée aux invités, une place libre = un bot, puis mise et assurance. */
  #botStep(state: BlackjackState, betweenRounds: boolean): boolean {
    const { rules } = state;
    const bots = state.seats.filter((seat): seat is BlackjackSeat => seat !== null && isBotPlayer(seat.player.id));

    if (betweenRounds) {
      const broke = bots.find((bot) => !canBet(bot, rules));
      if (broke !== undefined) {
        this.#apply(null, { type: 'LEAVE_SEAT', playerId: broke.player.id });
        this.#sit(broke.player.id, broke.player.displayName, DEFAULT_BALANCE, broke.seatIndex);
        return true;
      }
      const freeSeat = state.seats.indexOf(null);
      if (this.#queue.size > 0) {
        // Un invité attend et la table est pleine : le dernier bot lui cède sa place.
        const leaving = bots.at(-1);
        return freeSeat === -1 && leaving !== undefined && this.#apply(null, { type: 'LEAVE_SEAT', playerId: leaving.player.id });
      }
      if (freeSeat !== -1 && this.#engine.project(state, null).freePlaces >= 1) {
        const taken = new Set(state.seats.map((seat) => seat?.player.displayName));
        const name = BOT_NAMES.find((candidate) => !taken.has(candidate)) ?? `Bot ${freeSeat + 1}`;
        return this.#sit(playerId(`bot-${freeSeat}`), name, DEFAULT_BALANCE, freeSeat);
      }
    }

    if (state.phase === 'BETTING') {
      const bettor = bots.find((bot) => bot.pendingBets.length === 0 && canBet(bot, rules));
      const amount = bettor === undefined ? null : chooseBotBet(bettor.bankroll, rules, this.#rng);
      if (bettor !== undefined && amount !== null) {
        return this.#apply(null, { type: 'PLACE_BET', playerId: bettor.player.id, amount: chips(amount) });
      }
    }

    if (state.phase === 'INSURANCE') {
      const deciding = bots.find((bot) => bot.insurance.status === 'PENDING');
      if (deciding !== undefined) return this.#apply(null, { type: 'DECLINE_INSURANCE', playerId: deciding.player.id });
    }
    return false;
  }

  /** Un bot joue son tour après un court délai, pour que la table voie ses coups un par un. */
  #scheduleBot(): void {
    window.clearTimeout(this.#timer);
    const state = this.#state;
    if (state.phase !== 'PLAYER_TURNS') return;
    const id = state.seats[state.cursor.seatIndex]?.player.id;
    if (id === undefined || !isBotPlayer(id)) return;

    this.#timer = window.setTimeout(() => {
      const current = this.#state;
      if (current.phase !== 'PLAYER_TURNS') return;
      const seat = current.seats[current.cursor.seatIndex];
      const hand = seat?.hands[current.cursor.handIndex];
      const upCard = current.dealer.cards[0];
      if (seat?.player.id !== id || hand === undefined || upCard === undefined) return;
      const move = chooseBotMove(hand, upCard, this.#engine.legalActions(current, id).actions);
      this.#apply(null, { type: move, playerId: id });
      this.#settle();
    }, BOT_DELAY_MS);
  }
}
