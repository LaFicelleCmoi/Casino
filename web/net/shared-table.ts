import type { PlayerId } from '../../src/core/index.js';
import { MAX_TABLE_PLAYERS, connectToTable, openTableHost, type Channel, type SharedGame } from './peer-link.js';
import { cleanPlayerName } from './player-name.js';

/**
 * Logique d'une table côté créateur : seule source de vérité (sabot, paquet, cartes cachées).
 * Les invités ne reçoivent que leur projection anti-triche et n'envoient que des commandes, validées ici.
 */
export interface HostedTable<Snapshot, Command> {
  /** Assoit un invité, ou le met en attente de la prochaine manche ; message si la table le refuse. */
  join(name: string, bankroll: number): { readonly playerId: PlayerId } | { readonly error: string };
  leave(playerId: PlayerId): void;
  /** Commande brute reçue du réseau : validée par la table, jamais crue sur parole. */
  command(playerId: PlayerId, command: unknown): void;
  snapshotFor(playerId: PlayerId): Snapshot;
  subscribe(listener: () => void): () => void;
  /** Phantom : relie le type de commande à la table, sans coût à l'exécution. */
  readonly commandType?: Command;
}

/** Ce qu'une vue de table consomme, qu'elle joue sur la table locale (créateur) ou à distance (invité). */
export interface TableClient<Snapshot, Command> {
  snapshot(): Snapshot | null;
  send(command: Command): void;
  subscribe(listener: () => void): () => void;
  /** true quand la liaison avec le créateur est rompue (invité uniquement). */
  isClosed(): boolean;
  close(): void;
}

type GuestMessage =
  | { readonly kind: 'hello'; readonly name: string; readonly bankroll: number }
  | { readonly kind: 'command'; readonly command: unknown };

type HostMessage<Snapshot> =
  | { readonly kind: 'snapshot'; readonly snapshot: Snapshot }
  | { readonly kind: 'refused'; readonly reason: string };

function field(message: unknown, key: string): unknown {
  return typeof message === 'object' && message !== null ? (message as Record<string, unknown>)[key] : undefined;
}

export function localClient<Snapshot, Command>(table: HostedTable<Snapshot, Command>, playerId: PlayerId): TableClient<Snapshot, Command> {
  return {
    snapshot: () => table.snapshotFor(playerId),
    send: (command) => table.command(playerId, command),
    subscribe: (listener) => table.subscribe(listener),
    isClosed: () => false,
    close: () => {},
  };
}

export interface ShareSession {
  readonly link: string;
  close(): void;
}

/** Ouvre la table du créateur : chaque invité relié devient un joueur, qui reçoit sa propre projection à chaque changement. */
export async function shareTable<Snapshot, Command>(
  game: SharedGame,
  table: HostedTable<Snapshot, Command>,
  onChange: () => void,
): Promise<ShareSession> {
  const host = await openTableHost(game);
  const guests = new Map<Channel, PlayerId>();
  const send = (channel: Channel, message: HostMessage<Snapshot>): void => channel.send(message);
  const unsubscribe = table.subscribe(() => {
    for (const [channel, playerId] of guests) send(channel, { kind: 'snapshot', snapshot: table.snapshotFor(playerId) });
  });

  host.onGuest((channel) => {
    channel.onMessage((message) => {
      const playerId = guests.get(channel);
      const kind = field(message, 'kind');
      if (kind === 'command' && playerId !== undefined) {
        table.command(playerId, field(message, 'command'));
        return;
      }
      if (kind !== 'hello' || playerId !== undefined) return;

      const bankroll = field(message, 'bankroll');
      const joined =
        guests.size + 1 >= MAX_TABLE_PLAYERS
          ? { error: `Table complète : ${MAX_TABLE_PLAYERS} joueurs maximum.` }
          : table.join(cleanPlayerName(field(message, 'name')), typeof bankroll === 'number' && Number.isSafeInteger(bankroll) ? bankroll : 0);
      if ('error' in joined) {
        send(channel, { kind: 'refused', reason: joined.error });
        window.setTimeout(() => channel.close(), 1_000);
        return;
      }
      guests.set(channel, joined.playerId);
      send(channel, { kind: 'snapshot', snapshot: table.snapshotFor(joined.playerId) });
      onChange();
    });
    channel.onClose(() => {
      const playerId = guests.get(channel);
      guests.delete(channel);
      if (playerId === undefined) return;
      table.leave(playerId);
      onChange();
    });
  });

  return {
    link: host.link,
    close: () => {
      unsubscribe();
      host.close();
    },
  };
}

/** Relie un invité à la table du lien, se présente (pseudo et solde apporté) et attend sa première projection. */
export async function joinSharedTable<Snapshot, Command>(
  game: SharedGame,
  tableId: string,
  name: string,
  bankroll: number,
): Promise<TableClient<Snapshot, Command>> {
  const channel = await connectToTable(game, tableId);
  return new Promise((resolve, reject) => {
    let latest: Snapshot | null = null;
    const listeners = new Set<() => void>();
    const notify = (): void => {
      for (const listener of [...listeners]) listener();
    };
    const client: TableClient<Snapshot, Command> = {
      snapshot: () => latest,
      send: (command) => channel.send({ kind: 'command', command } satisfies GuestMessage),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      isClosed: () => channel.closed,
      close: () => channel.close(),
    };

    channel.onMessage((message) => {
      const kind = field(message, 'kind');
      if (kind === 'refused') {
        const reason = field(message, 'reason');
        reject(new Error(typeof reason === 'string' ? reason : 'La table a refusé la connexion.'));
        channel.close();
      } else if (kind === 'snapshot') {
        latest = field(message, 'snapshot') as Snapshot;
        resolve(client);
        notify();
      }
    });
    channel.onClose(() => {
      reject(new Error('Le créateur de la table a coupé la connexion.'));
      notify();
    });
    channel.send({ kind: 'hello', name, bankroll } satisfies GuestMessage);
  });
}
