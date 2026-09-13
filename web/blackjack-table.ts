import { chips, playerId, type PlayerId } from '../src/core/index.js';
import {
  BlackjackController,
  STANDARD_BLACKJACK_RULES,
  type BlackjackCommand,
  type BlackjackRules,
  type BlackjackSeat,
  type BlackjackState,
  type BlackjackTableView,
} from '../src/blackjack/index.js';
import { MAX_TABLE_PLAYERS } from './net/peer-link.js';
import { cleanPlayerName } from './net/player-name.js';
import type { HostedTable } from './net/shared-table.js';
import { expectOk, formatChips } from './ui.js';

/** 8 places : un joueur seul peut y jouer jusqu'à 8 mains, huit joueurs une main chacun. */
export const BLACKJACK_TABLE_RULES: BlackjackRules = { ...STANDARD_BLACKJACK_RULES, seatCount: MAX_TABLE_PLAYERS };

/** Créateur de la table ; les invités reçoivent « invite-1 », « invite-2 »… */
export const BLACKJACK_HOST: PlayerId = playerId('hote');

const SEAT_ACTIONS = ['CLEAR_BET', 'TAKE_INSURANCE', 'DECLINE_INSURANCE', 'HIT', 'STAND', 'DOUBLE_DOWN', 'SPLIT', 'SURRENDER'] as const;
export type BlackjackSeatAction = (typeof SEAT_ACTIONS)[number];
export const isSeatAction = (value: unknown): value is BlackjackSeatAction => (SEAT_ACTIONS as readonly unknown[]).includes(value);

/** Ce qu'un joueur envoie à la table : jamais son identifiant, que la table déduit de sa connexion. */
export type BlackjackTableCommand =
  | { readonly type: BlackjackSeatAction }
  | { readonly type: 'PLACE_BET'; readonly amount: number; readonly box: number }
  /** Prêt pour la donne : les cartes partent quand tous les joueurs pouvant miser sont prêts. */
  | { readonly type: 'READY' }
  | { readonly type: 'NEXT_ROUND' }
  /** Nouveau solde après la recharge du jour, appliqué entre deux manches. */
  | { readonly type: 'REBUY'; readonly bankroll: number }
  | { readonly type: 'RENAME'; readonly name: string };

export interface BlackjackSnapshot {
  readonly view: BlackjackTableView;
  readonly me: PlayerId;
  readonly ready: readonly PlayerId[];
  /** Pseudos des invités arrivés en pleine manche, assis dès la suivante. */
  readonly waiting: readonly string[];
  /** Dernière commande refusée à ce joueur. */
  readonly notice: string | null;
  /** Joueurs réels à la table (assis ou en attente), créateur compris. */
  readonly players: number;
}

function parseCommand(raw: unknown): BlackjackTableCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { type, amount, box, bankroll, name } = raw as Record<string, unknown>;
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
    default:
      return null;
  }
}

/** Un joueur qui peut encore miser doit confirmer « Prêt » (ou passer) avant la donne. */
const canBet = (seat: BlackjackSeat, rules: BlackjackRules): boolean =>
  seat.bankroll + seat.pendingBets.reduce((sum, bet) => sum + bet, 0) >= rules.minBet;

/**
 * Table de Blackjack côté créateur, en solo comme en partage : seule détentrice de l'état (donc du sabot), elle valide
 * chaque commande avec le moteur, joue à la place des absents et n'expose à chaque joueur que sa projection.
 */
export class BlackjackTable implements HostedTable<BlackjackSnapshot, BlackjackTableCommand> {
  readonly #engine: BlackjackController;
  #state: BlackjackState;
  readonly #ready = new Set<PlayerId>();
  readonly #notices = new Map<PlayerId, string>();
  readonly #names = new Map<PlayerId, string>();
  /** Invités arrivés en pleine manche (ou faute de place) : assis dès que possible. */
  readonly #queue = new Map<PlayerId, { readonly name: string; readonly bankroll: number }>();
  /** Joueurs partis : ils restent sur leurs mains jusqu'au règlement, puis quittent la table. */
  readonly #leaving = new Set<PlayerId>();
  readonly #listeners = new Set<() => void>();
  #guests = 0;

  constructor(engine: BlackjackController, hostName: string, hostBankroll: number) {
    this.#engine = engine;
    this.#state = expectOk(engine.createTable(BLACKJACK_TABLE_RULES));
    this.#names.set(BLACKJACK_HOST, hostName);
    if (hostBankroll > 0) this.#sit(BLACKJACK_HOST, hostName, hostBankroll);
  }

  get state(): BlackjackState {
    return this.#state;
  }

  /** Codes de triche du créateur : remplace l'état puis prévient tous les joueurs. */
  replaceState(next: BlackjackState): void {
    this.#state = next;
    this.#settle();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
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
    };
  }

  #run(id: PlayerId, command: BlackjackTableCommand): void {
    switch (command.type) {
      case 'READY':
        if (this.#seatOf(id) !== null) this.#ready.add(id);
        return;
      case 'NEXT_ROUND':
        this.#apply(id, { type: 'NEXT_ROUND' });
        return;
      case 'PLACE_BET':
        if (!Number.isSafeInteger(command.amount) || command.amount <= 0) {
          this.#notices.set(id, 'Mise invalide.');
          return;
        }
        this.#apply(id, { type: 'PLACE_BET', playerId: id, amount: chips(command.amount), box: command.box });
        return;
      case 'REBUY':
        this.#rebuy(id, command.bankroll);
        return;
      case 'RENAME':
        this.#rename(id, cleanPlayerName(command.name));
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
    this.#state = result.value.state;
    return true;
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
    const seated = this.#state.seats.filter((seat) => seat !== null && !this.#leaving.has(seat.player.id)).length;
    return seated + this.#queue.size;
  }

  /** Enchaîne les étapes automatiques (départs, arrivées, donne, jeu des absents), puis prévient les joueurs. */
  #settle(): void {
    for (let guard = 0; guard < 200 && this.#step(); guard += 1) {
      // Chaque étape modifie l'état : on recommence jusqu'à stabilité.
    }
    for (const listener of [...this.#listeners]) listener();
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
}
