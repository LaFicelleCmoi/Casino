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
import {
  DEFAULT_HOUSE,
  EMPTY_SERVICE,
  PERFECT_PAIRS_EDGE,
  PERFECT_PAIRS_PAYOUTS,
  SLOW_GESTURE_MS,
  applyHouseRules,
  arrivalChance,
  betAppetite,
  departureChance,
  guestTip,
  houseEdge,
  parseHouseRules,
  perfectPair,
  serviceNote,
  sideBetSteps,
  speedFactor,
  tipAmount,
  tipChance,
  type HouseRules,
  type PerfectPair,
  type ServiceNote,
  type ServiceStats,
} from './blackjack-house.js';
import { EMPTY_DEALER_SAVE, uniqueNames, type DealerSave } from './dealer-save.js';
import { MAX_TABLE_PLAYERS } from './net/peer-link.js';
import { cleanPlayerName } from './net/player-name.js';
import type { HostedTable } from './net/shared-table.js';
import { expectOk, formatChips } from './ui.js';

/** 8 places : un joueur seul peut y jouer jusqu'à 8 mains, huit joueurs une main chacun. */
export const BLACKJACK_TABLE_RULES: BlackjackRules = { ...STANDARD_BLACKJACK_RULES, seatCount: MAX_TABLE_PLAYERS };

/** Créateur de la table ; les invités reçoivent « invite-1 », « invite-2 »…, les bots « bot-<place> ». */
export const BLACKJACK_HOST: PlayerId = playerId('hote');

/** Part des bots qui tentent les Paires parfaites quand la table les propose. */
const BOT_SIDE_BET_PERCENT = 35;
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
  | { readonly type: 'GRANT'; readonly target: string; readonly amount: number }
  /** Créateur croupier, entre deux manches : règles de la maison (paiements, sabot, limites, pari annexe, service). */
  | { readonly type: 'HOUSE_RULES'; readonly rules: HouseRules }
  /** Créateur croupier : service noté terminé, on en commence un autre. */
  | { readonly type: 'NEW_SERVICE' }
  /** Créateur croupier : renommer un bot assis ; le nouveau nom remplace l'ancien dans la liste des bots. */
  | { readonly type: 'RENAME_BOT'; readonly target: string; readonly name: string }
  /** Mise « Paires parfaites » (0 pour la retirer), avant la donne, quand le croupier la propose. */
  | { readonly type: 'SIDE_BET'; readonly amount: number }
  /** Pourboire d'un joueur au croupier humain. */
  | { readonly type: 'TIP' };

export interface SideBetResult {
  readonly seatIndex: number;
  readonly stake: number;
  readonly pair: PerfectPair | null;
  /** Gain net du joueur : négatif s'il perd sa mise. */
  readonly net: number;
}

export interface SeatTip {
  readonly seatIndex: number;
  readonly amount: number;
}

export interface BlackjackService {
  readonly length: number;
  readonly stats: ServiceStats;
  /** Présente une fois le service terminé. */
  readonly note: ServiceNote | null;
}

export interface BlackjackDealerInfo {
  readonly name: string;
  /** Banque du croupier : elle encaisse les mises perdues et paie les gains des joueurs. */
  readonly bank: number;
  /** Variation de la banque et pourboires reçus sur la dernière manche réglée. */
  readonly lastRound: { readonly roundNumber: number; readonly net: number; readonly tips: number } | null;
  /** Cagnotte des pourboires du service, versée au solde du croupier à la fin du service. */
  readonly tips: number;
  /** Pourboires de la manche, par place. */
  readonly roundTips: readonly SeatTip[];
  /** Départs et arrivées de joueurs au début de la manche. */
  readonly movement: { readonly left: readonly string[]; readonly arrived: readonly string[] } | null;
  /** Dernier pourboire laissé par un vrai joueur : son numéro change à chaque nouveau pourboire. */
  readonly lastGuestTip: { readonly name: string; readonly amount: number; readonly serial: number } | null;
  readonly service: BlackjackService;
  /** Tous les pourboires reçus depuis le premier service, conservés d'une visite à l'autre. */
  readonly lifetimeTips: number;
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
  /** Règles de la maison en vigueur (standard hors mode croupier). */
  readonly house: HouseRules;
  /** Mises « Paires parfaites » posées pour la prochaine donne. */
  readonly sideBets: readonly SeatTip[];
  /** Résultats des Paires parfaites de la manche en cours. */
  readonly sideResults: readonly SideBetResult[];
  /** Total des pourboires laissés par ce joueur : sa hausse est comptée à son bilan. */
  readonly tipped: number;
}

function parseCommand(raw: unknown): BlackjackTableCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { type, amount, box, bankroll, name, enabled, action, target, rules } = raw as Record<string, unknown>;
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
    case 'HOUSE_RULES': {
      const house = parseHouseRules(rules);
      return house === null ? null : { type: 'HOUSE_RULES', rules: house };
    }
    case 'NEW_SERVICE':
      return { type: 'NEW_SERVICE' };
    case 'RENAME_BOT':
      return typeof target === 'string' && typeof name === 'string' ? { type: 'RENAME_BOT', target, name } : null;
    case 'SIDE_BET':
      return typeof amount === 'number' ? { type: 'SIDE_BET', amount } : null;
    case 'TIP':
      return { type: 'TIP' };
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
  /** Règles choisies par le croupier, gardées quand il redevient joueur pour son prochain service. */
  #house: HouseRules = DEFAULT_HOUSE;
  readonly #sideBets = new Map<PlayerId, number>();
  /** Bots qui ont déjà décidé de leur pari annexe pour la prochaine donne. */
  readonly #sideDecided = new Set<PlayerId>();
  #sideResults: SideBetResult[] = [];
  /** Gain de la banque sur les Paires parfaites de la manche, encaissé au règlement avec le reste. */
  #sideBankNet = 0;
  #jar = 0;
  #roundTips: SeatTip[] = [];
  #tipsSinceSettle = 0;
  #lastGuestTip: BlackjackDealerInfo['lastGuestTip'] = null;
  readonly #tipped = new Map<PlayerId, number>();
  #movement: BlackjackDealerInfo['movement'] = null;
  /** Manche dont les départs et arrivées ont déjà été tirés. */
  #movedRound = -1;
  /** Le croupier vient de prendre son poste : toutes les places libres se remplissent d'un coup. */
  #fillAll = false;
  #service: ServiceStats = EMPTY_SERVICE;
  #note: ServiceNote | null = null;
  /** Depuis quand le croupier doit faire un geste, pour mesurer sa rapidité. */
  #gestureSince: number | null = null;
  #roundGestures = { count: 0, ms: 0 };
  /** Pendant la donne du croupier : le règlement attend que les Paires parfaites soient payées. */
  #deferSettle = false;
  #lifetimeTips: number;
  #botNames: string[];
  /** Service et cagnotte sauvegardés, repris quand le créateur reprend son poste de croupier. */
  #resume: { readonly jar: number; readonly service: ServiceStats };

  constructor(
    engine: BlackjackController,
    rng: RandomSource,
    hostName: string,
    hostBankroll: number,
    saved: DealerSave = EMPTY_DEALER_SAVE,
  ) {
    this.#engine = engine;
    this.#rng = rng;
    this.#house = saved.house;
    this.#lifetimeTips = saved.lifetimeTips;
    this.#botNames = [...saved.botNames];
    this.#resume = { jar: saved.jar, service: saved.service };
    this.#state = expectOk(engine.createTable(BLACKJACK_TABLE_RULES));
    this.#names.set(BLACKJACK_HOST, hostName);
    if (hostBankroll > 0) this.#sit(BLACKJACK_HOST, hostName, hostBankroll);
  }

  get state(): BlackjackState {
    return this.#state;
  }

  /**
   * Poste du croupier à sauvegarder. Hors service, la cagnotte et le service repris restent en attente : ils ne sont
   * perdus que si le créateur redevient joueur (la cagnotte rejoint alors son solde).
   */
  get dealerSave(): DealerSave {
    const current = this.#dealerMode ? { jar: this.#jar, service: this.#note === null ? this.#service : EMPTY_SERVICE } : this.#resume;
    return { house: this.#house, ...current, lifetimeTips: this.#lifetimeTips, botNames: this.#botNames };
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
    this.#sideBets.delete(id);
    this.#tipped.delete(id);
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
        ? {
            name: this.#names.get(BLACKJACK_HOST) ?? cleanPlayerName(null),
            bank: this.#bank,
            lastRound: this.#lastRound,
            tips: this.#jar,
            roundTips: this.#roundTips,
            movement: this.#movement,
            lastGuestTip: this.#lastGuestTip,
            service: { length: this.#house.serviceLength, stats: this.#service, note: this.#note },
            lifetimeTips: this.#lifetimeTips,
          }
        : null,
      credited: this.#credits.get(id) ?? 0,
      house: this.#houseInForce(),
      sideBets: [...this.#sideBets].flatMap(([player, amount]) => {
        const seat = this.#seatOf(player);
        return seat === null ? [] : [{ seatIndex: seat.seatIndex, amount }];
      }),
      sideResults: this.#state.phase === 'BETTING' ? [] : this.#sideResults,
      tipped: this.#tipped.get(id) ?? 0,
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
        else {
          this.#timeGesture();
          this.#apply(id, { type: command.action });
        }
        return;
      case 'GRANT':
        if (host) this.#grant(playerId(command.target), command.amount);
        else this.#notices.set(id, 'Seul le créateur de la table rend des jetons.');
        return;
      case 'HOUSE_RULES':
        if (host && this.#dealerMode) this.#setHouse(command.rules);
        else this.#notices.set(id, 'Seul le croupier fixe les règles de la maison.');
        return;
      case 'NEW_SERVICE':
        if (host && this.#dealerMode) this.#newService();
        else this.#notices.set(id, 'Seul le croupier commence un service.');
        return;
      case 'RENAME_BOT':
        if (host && this.#dealerMode) this.#renameBot(playerId(command.target), command.name);
        else this.#notices.set(id, 'Seul le croupier renomme les bots.');
        return;
      case 'SIDE_BET':
        this.#placeSideBet(id, command.amount);
        return;
      case 'TIP':
        this.#tip(id);
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
    if (this.#dealerMode && !this.#deferSettle && !wasOver && this.#state.phase === 'ROUND_OVER') this.#settleBank();
    return true;
  }

  /**
   * La banque encaisse ce que les joueurs perdent (Paires parfaites comprises) et paie ce qu'ils gagnent ; elle ne
   * descend jamais sous zéro. Les gagnants laissent ensuite leurs pourboires, et le service avance d'une manche.
   */
  #settleBank(): void {
    const state = this.#state;
    if (state.phase !== 'ROUND_OVER') return;
    const players =
      sum(state.settlements.map((settlement) => settlement.returned - settlement.stake)) +
      sum(state.insuranceSettlements.map((settlement) => settlement.returned - settlement.stake));
    const bank = Math.max(0, this.#bank - players + this.#sideBankNet);
    const net = bank - this.#bank;
    this.#bank = bank;
    this.#sideBankNet = 0;
    this.#tipBots(state);
    this.#lastRound = { roundNumber: state.roundNumber, net, tips: this.#tipsSinceSettle };
    this.#tipsSinceSettle = 0;
    this.#service = { ...this.#service, rounds: this.#service.rounds + 1, bankNet: this.#service.bankNet + net };
    if (this.#note === null && this.#service.rounds >= this.#house.serviceLength) this.#endService();
  }

  /** Les bots gagnants laissent parfois un pourboire : plus souvent à une table généreuse et à un croupier vif. */
  #tipBots(state: Extract<BlackjackState, { phase: 'ROUND_OVER' }>): void {
    const average = this.#roundGestures.count === 0 ? null : this.#roundGestures.ms / this.#roundGestures.count;
    const chance = tipChance(this.#house) * speedFactor(average);
    for (const seat of this.#state.seats) {
      if (seat === null || !isBotPlayer(seat.player.id)) continue;
      const settlements = state.settlements.filter((settlement) => settlement.seatIndex === seat.seatIndex);
      const won = sum(settlements.map((settlement) => settlement.returned - settlement.stake));
      if (won <= 0 || !this.#chance(chance)) continue;
      const blackjack = settlements.some((settlement) => settlement.outcome === 'BLACKJACK');
      const amount = Math.min(seat.bankroll, tipAmount(sum(settlements.map((settlement) => settlement.stake)), blackjack));
      if (amount > 0) this.#payTip(seat, amount);
    }
  }

  /** Un joueur verse un pourboire : il quitte sa bankroll pour la cagnotte du croupier. */
  #payTip(seat: BlackjackSeat, amount: number): void {
    const paid: BlackjackSeat = { ...seat, bankroll: chips(seat.bankroll - amount) };
    this.#state = { ...this.#state, seats: this.#state.seats.map((current) => (current?.seatIndex === seat.seatIndex ? paid : current)) };
    this.#jar += amount;
    this.#lifetimeTips += amount;
    this.#tipsSinceSettle += amount;
    this.#roundTips = [...this.#roundTips, { seatIndex: seat.seatIndex, amount }];
    this.#service = { ...this.#service, tips: this.#service.tips + amount };
  }

  /** Pourboire d'un vrai joueur, d'un clic, à n'importe quel moment. */
  #tip(id: PlayerId): void {
    const seat = this.#seatOf(id);
    if (!this.#dealerMode || id === BLACKJACK_HOST || seat === null) {
      this.#notices.set(id, 'Il faut être assis face à un croupier pour laisser un pourboire.');
      return;
    }
    const amount = guestTip(this.#house);
    if (seat.bankroll < amount) {
      this.#notices.set(id, 'Pas assez de jetons pour ce pourboire.');
      return;
    }
    this.#payTip(seat, amount);
    this.#tipped.set(id, (this.#tipped.get(id) ?? 0) + amount);
    this.#lastGuestTip = { name: seat.player.displayName, amount, serial: (this.#lastGuestTip?.serial ?? 0) + 1 };
  }

  #placeSideBet(id: PlayerId, amount: number): void {
    const seat = this.#seatOf(id);
    if (!this.#dealerMode || !this.#house.perfectPairs) this.#notices.set(id, 'Cette table ne propose pas les Paires parfaites.');
    else if (this.#state.phase !== 'BETTING') this.#notices.set(id, 'Les Paires parfaites se misent avant la donne.');
    else if (seat === null) this.#notices.set(id, 'Asseyez-vous pour miser.');
    else if (!sideBetSteps(this.#house).includes(amount)) this.#notices.set(id, 'Mise annexe invalide.');
    else if (amount > seat.bankroll) this.#notices.set(id, 'Pas assez de jetons pour cette mise annexe.');
    else if (amount === 0) this.#sideBets.delete(id);
    else this.#sideBets.set(id, amount);
  }

  /** Paie les Paires parfaites sur les deux premières cartes de la première main, juste après la donne. */
  #settleSideBets(): number {
    this.#sideResults = [];
    let staked = 0;
    for (const [id, stake] of this.#sideBets) {
      const seat = this.#seatOf(id);
      const [first, second] = seat?.hands[0]?.cards ?? [];
      if (seat === null || first === undefined || second === undefined || seat.bankroll < stake) continue;
      const pair = perfectPair(first, second);
      const payout = pair === null ? 0 : stake * (PERFECT_PAIRS_PAYOUTS[pair] + 1);
      const settled: BlackjackSeat = { ...seat, bankroll: chips(seat.bankroll - stake + payout) };
      this.#state = { ...this.#state, seats: this.#state.seats.map((current) => (current === seat ? settled : current)) };
      staked += stake;
      this.#sideBankNet += stake - payout;
      this.#sideResults.push({ seatIndex: seat.seatIndex, stake, pair, net: payout - stake });
    }
    this.#sideBets.clear();
    return staked;
  }

  #dealerDeal(): void {
    if (this.#note !== null) {
      this.#notices.set(BLACKJACK_HOST, 'Service terminé : lancez un nouveau service pour distribuer.');
      return;
    }
    if (this.#bank <= 0) {
      this.#notices.set(BLACKJACK_HOST, 'La banque est vide : rechargez-la pour distribuer.');
      return;
    }
    this.#deferSettle = true;
    const dealt = this.#apply(BLACKJACK_HOST, { type: 'DEAL' });
    this.#deferSettle = false;
    if (!dealt) return;
    this.#ready.clear();
    this.#sideDecided.clear();
    this.#roundTips = [];
    this.#movement = null;
    this.#roundGestures = { count: 0, ms: 0 };
    const seats = this.#state.seats.filter((seat): seat is BlackjackSeat => seat !== null);
    const main = sum(seats.flatMap((seat) => seat.hands.map((hand) => hand.bet)));
    const side = this.#settleSideBets();
    const service = this.#service;
    this.#service = {
      ...service,
      wagered: service.wagered + main + side,
      theo: service.theo + (main * houseEdge(this.#house) + side * PERFECT_PAIRS_EDGE) / 100,
      seatsFilled: service.seatsFilled + seats.length,
      deals: service.deals + 1,
    };
    // Blackjack du croupier vu dès la donne : la manche est déjà finie, on la règle maintenant.
    if (this.#state.phase === 'ROUND_OVER') this.#settleBank();
  }

  /** Mesure le temps de réaction du croupier sur chaque geste de sa main. */
  #timeGesture(): void {
    if (this.#gestureSince === null) return;
    const ms = Date.now() - this.#gestureSince;
    this.#gestureSince = null;
    this.#roundGestures = { count: this.#roundGestures.count + 1, ms: this.#roundGestures.ms + ms };
    this.#service = { ...this.#service, gestures: this.#service.gestures + 1, gestureMs: this.#service.gestureMs + ms };
  }

  /** Fin du service : la note tombe et la cagnotte des pourboires rejoint la banque, donc le solde du croupier. */
  #endService(): void {
    this.#note = serviceNote(this.#service, this.#house.minBet, this.#state.rules.seatCount);
    this.#bank += this.#jar;
    this.#jar = 0;
  }

  #newService(): void {
    this.#bank += this.#jar;
    this.#jar = 0;
    this.#service = EMPTY_SERVICE;
    this.#note = null;
    if (this.#state.phase === 'ROUND_OVER') this.#apply(BLACKJACK_HOST, { type: 'NEXT_ROUND' });
  }

  #houseInForce(): HouseRules {
    return this.#dealerMode ? this.#house : DEFAULT_HOUSE;
  }

  #setHouse(next: HouseRules): void {
    const { phase } = this.#state;
    if (phase !== 'BETTING' && phase !== 'ROUND_OVER') {
      this.#notices.set(BLACKJACK_HOST, 'Les règles de la maison changent entre deux manches.');
      return;
    }
    const previous = this.#houseInForce();
    this.#house = next;
    this.#enforce(previous);
    if (this.#note === null && this.#service.rounds > 0 && this.#service.rounds >= next.serviceLength) this.#endService();
  }

  /**
   * Met les règles du moteur en accord avec la maison. Un autre nombre de jeux remélange le sabot à la prochaine
   * donne ; d'autres limites annulent les mises posées, que chacun replace.
   */
  #enforce(previous: HouseRules): void {
    const house = this.#houseInForce();
    const state = this.#state;
    const rules = { ...applyHouseRules(state.rules, house), dealerPlay: this.#dealerMode ? ('MANUAL' as const) : ('AUTO' as const) };
    const shoe = house.decks === previous.decks ? state.shoe : { ...state.shoe, cutCardIndex: 0 };
    this.#state = { ...state, rules, shoe };
    if (!house.perfectPairs) this.#sideBets.clear();
    if (house.minBet !== previous.minBet || house.maxBet !== previous.maxBet) {
      for (const seat of this.#state.seats) {
        if (seat !== null && seat.pendingBets.length > 0) this.#apply(null, { type: 'CLEAR_BET', playerId: seat.player.id });
      }
      this.#sideBets.clear();
      this.#sideDecided.clear();
      this.#ready.clear();
    }
  }

  /** Changement de rôle du créateur, entre deux manches : son solde devient la banque, ou la banque redevient son solde. */
  #setDealerMode(enabled: boolean): void {
    if (enabled === this.#dealerMode) return;
    const { phase } = this.#state;
    if (phase !== 'BETTING' && phase !== 'ROUND_OVER') {
      this.#notices.set(BLACKJACK_HOST, 'Le changement de rôle se fait entre deux manches.');
      return;
    }
    const previous = this.#houseInForce();
    let jar = 0;
    if (enabled) {
      const seat = this.#seatOf(BLACKJACK_HOST);
      const balance = seat === null ? 0 : seat.bankroll + sum(seat.pendingBets);
      // La cagnotte sauvegardée fait partie du solde : on l'en retire pour reprendre le service là où il s'était arrêté.
      jar = Math.min(this.#resume.jar, balance);
      this.#bank = balance - jar;
      if (seat !== null) this.#apply(null, { type: 'LEAVE_SEAT', playerId: BLACKJACK_HOST });
      this.#fillAll = true;
      this.#movedRound = this.#state.roundNumber;
    } else {
      for (const seat of this.#state.seats) {
        if (seat !== null && isBotPlayer(seat.player.id)) this.#apply(null, { type: 'LEAVE_SEAT', playerId: seat.player.id });
      }
      const balance = this.#bank + this.#jar;
      if (balance > 0) this.#sit(BLACKJACK_HOST, this.#names.get(BLACKJACK_HOST) ?? cleanPlayerName(null), balance);
      this.#bank = 0;
    }
    this.#jar = jar;
    this.#service = enabled ? this.#resume.service : EMPTY_SERVICE;
    this.#resume = { jar: 0, service: EMPTY_SERVICE };
    this.#lastRound = null;
    this.#roundTips = [];
    this.#movement = null;
    this.#note = null;
    this.#sideBets.clear();
    this.#sideResults = [];
    this.#dealerMode = enabled;
    this.#enforce(previous);
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

  /** Un bot change de nom : à sa place tout de suite, et dans la liste des bots pour ses prochaines venues. */
  #renameBot(target: PlayerId, raw: string): void {
    const seat = this.#seatOf(target);
    if (seat === null || !isBotPlayer(target)) {
      this.#notices.set(BLACKJACK_HOST, 'Ce bot a quitté la table.');
      return;
    }
    const name = cleanPlayerName(raw);
    const old = seat.player.displayName;
    const key = (value: string): string => value.toLocaleLowerCase('fr');
    const taken = [
      ...this.#state.seats.flatMap((other) => (other === null || other === seat ? [] : [other.player.displayName])),
      ...[...this.#queue.values()].map((guest) => guest.name),
      ...this.#botNames.filter((candidate) => key(candidate) !== key(old)),
    ];
    if (key(name) !== key(old) && taken.some((candidate) => key(candidate) === key(name))) {
      this.#notices.set(BLACKJACK_HOST, `« ${name} » est déjà pris.`);
      return;
    }
    const index = this.#botNames.findIndex((candidate) => key(candidate) === key(old));
    const names = [...this.#botNames];
    if (index === -1) names.push(name);
    else names[index] = name;
    this.#botNames = uniqueNames(names);
    this.#rename(target, name);
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
    // Le chronomètre du croupier tourne dès qu'un geste l'attend.
    if (this.#dealerMode && this.#state.phase === 'DEALER_TURN') this.#gestureSince ??= Date.now();
    else this.#gestureSince = null;
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

  /**
   * Bots de la table du croupier : place cédée aux invités, table remplie à la prise de poste, puis à chaque manche des
   * départs et des arrivées selon les règles de la maison ; enfin mises, Paires parfaites et assurance.
   */
  #botStep(state: BlackjackState, betweenRounds: boolean): boolean {
    const { rules } = state;
    const bots = state.seats.filter((seat): seat is BlackjackSeat => seat !== null && isBotPlayer(seat.player.id));

    if (betweenRounds) {
      const freeSeat = state.seats.indexOf(null);
      if (this.#queue.size > 0) {
        // Un invité attend et la table est pleine : le dernier bot lui cède sa place.
        const leaving = bots.at(-1);
        return freeSeat === -1 && leaving !== undefined && this.#apply(null, { type: 'LEAVE_SEAT', playerId: leaving.player.id });
      }
      if (this.#fillAll) {
        if (freeSeat !== -1 && this.#engine.project(state, null).freePlaces >= 1 && this.#sitBot(freeSeat) !== null) return true;
        this.#fillAll = false;
      }
    }

    if (state.phase === 'BETTING' && this.#movedRound !== state.roundNumber) {
      this.#movedRound = state.roundNumber;
      this.#moveBots(bots);
      return true;
    }

    if (state.phase === 'BETTING') {
      const bettor = bots.find((bot) => bot.pendingBets.length === 0 && canBet(bot, rules));
      const amount = bettor === undefined ? null : chooseBotBet(bettor.bankroll, rules, this.#rng, betAppetite(this.#house));
      if (bettor !== undefined && amount !== null) {
        return this.#apply(null, { type: 'PLACE_BET', playerId: bettor.player.id, amount: chips(amount) });
      }
      const deciding = this.#house.perfectPairs
        ? bots.find((bot) => bot.pendingBets.length > 0 && !this.#sideDecided.has(bot.player.id))
        : undefined;
      if (deciding !== undefined) {
        this.#sideDecided.add(deciding.player.id);
        if (this.#rng.nextInt(100) < BOT_SIDE_BET_PERCENT && deciding.bankroll >= rules.minBet) this.#sideBets.set(deciding.player.id, rules.minBet);
        return true;
      }
    }

    if (state.phase === 'INSURANCE') {
      const deciding = bots.find((bot) => bot.insurance.status === 'PENDING');
      if (deciding !== undefined) return this.#apply(null, { type: 'DECLINE_INSURANCE', playerId: deciding.player.id });
    }
    return false;
  }

  /** Début de manche : les bots ruinés ou lassés partent, les places libres trouvent preneur selon l'attrait de la table. */
  #moveBots(bots: readonly BlackjackSeat[]): void {
    const { rules } = this.#state;
    const slow = this.#roundGestures.count > 0 && this.#roundGestures.ms / this.#roundGestures.count > SLOW_GESTURE_MS;
    const leaveChance = departureChance(this.#house, slow);
    const left: string[] = [];
    for (const bot of bots) {
      if (canBet(bot, rules) && !this.#chance(leaveChance)) continue;
      if (this.#apply(null, { type: 'LEAVE_SEAT', playerId: bot.player.id })) left.push(bot.player.displayName);
    }
    const arrived: string[] = [];
    const arriveChance = arrivalChance(this.#house);
    for (let seatIndex = 0; seatIndex < rules.seatCount; seatIndex += 1) {
      if (this.#queue.size > 0 || this.#engine.project(this.#state, null).freePlaces < 1) break;
      if (this.#state.seats[seatIndex] !== null || !this.#chance(arriveChance)) continue;
      const name = this.#sitBot(seatIndex);
      if (name !== null) arrived.push(name);
    }
    this.#movement = left.length + arrived.length > 0 ? { left, arrived } : null;
  }

  /** Un nouveau bot s'assoit avec 50 à 150 fois le minimum de table. */
  #sitBot(seatIndex: number): string | null {
    const taken = new Set(this.#state.seats.map((seat) => seat?.player.displayName));
    const free = this.#botNames.filter((candidate) => !taken.has(candidate));
    const name = free[this.#rng.nextInt(Math.max(1, free.length))] ?? `Bot ${seatIndex + 1}`;
    const bankroll = this.#state.rules.minBet * (50 + this.#rng.nextInt(101));
    return this.#sit(playerId(`bot-${seatIndex}`), name, bankroll, seatIndex) ? name : null;
  }

  #chance(probability: number): boolean {
    return this.#rng.nextInt(10_000) < probability * 10_000;
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
