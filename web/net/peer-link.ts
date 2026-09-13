import Peer, { type DataConnection } from 'peerjs';

/** Jeux jouables à plusieurs via un lien d'invitation. */
export type SharedGame = 'blackjack' | 'holdem';

/** Joueurs réels par table partagée, créateur compris. */
export const MAX_TABLE_PLAYERS = 8;

const PEER_PREFIX = 'casino-engine-';
const HEARTBEAT_MS = 4_000;
const SILENCE_LIMIT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 20_000;
const TABLE_ID_PATTERN = /^[a-z0-9]{8,32}$/;

export const isTableId = (value: string): boolean => TABLE_ID_PATTERN.test(value);

const peerIdFor = (game: SharedGame, tableId: string): string => `${PEER_PREFIX}${game}-${tableId}`;

/** 16 caractères aléatoires : impossible à deviner, donc seuls les destinataires du lien trouvent la table. */
function randomTableId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('');
}

export function inviteLink(game: SharedGame, tableId: string): string {
  return `${location.origin}${location.pathname}#/${game}/${tableId}`;
}

function describePeerError(type: string): string {
  switch (type) {
    case 'peer-unavailable':
      return "Table introuvable : son créateur l'a fermée ou le lien est incomplet.";
    case 'browser-incompatible':
      return 'Ce navigateur ne permet pas le jeu à plusieurs (WebRTC indisponible).';
    case 'unavailable-id':
      return 'Identifiant de table déjà utilisé : réessayez.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Serveur de mise en relation injoignable : vérifiez votre connexion internet.';
    default:
      return `Connexion impossible (${type}).`;
  }
}

const isPing = (data: unknown): boolean =>
  typeof data === 'object' && data !== null && (data as { readonly kind?: unknown }).kind === 'ping';

/**
 * Canal fiable entre deux navigateurs (WebRTC). Un battement de cœur détecte en quelques secondes un onglet fermé
 * ou une coupure réseau, que WebRTC seul peut mettre longtemps à signaler.
 */
export class Channel {
  readonly #connection: DataConnection;
  readonly #messageListeners = new Set<(message: unknown) => void>();
  readonly #closeListeners = new Set<() => void>();
  readonly #heartbeat: number;
  #lastSeen = Date.now();
  #closed = false;

  constructor(connection: DataConnection) {
    this.#connection = connection;
    connection.on('data', (data) => {
      this.#lastSeen = Date.now();
      if (isPing(data)) return;
      for (const listener of [...this.#messageListeners]) listener(data);
    });
    connection.on('close', () => this.close());
    connection.on('error', () => this.close());
    this.#heartbeat = window.setInterval(() => {
      if (Date.now() - this.#lastSeen > SILENCE_LIMIT_MS) this.close();
      else this.send({ kind: 'ping' });
    }, HEARTBEAT_MS);
  }

  get closed(): boolean {
    return this.#closed;
  }

  send(message: unknown): void {
    if (this.#closed) return;
    try {
      void this.#connection.send(message);
    } catch {
      this.close();
    }
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    window.clearInterval(this.#heartbeat);
    this.#connection.close();
    for (const listener of [...this.#closeListeners]) listener();
    this.#messageListeners.clear();
    this.#closeListeners.clear();
  }
}

export interface TableHost {
  readonly tableId: string;
  readonly link: string;
  onGuest(listener: (channel: Channel) => void): void;
  close(): void;
}

/** Inscrit la table du créateur auprès du serveur de mise en relation PeerJS ; les invités s'y relient ensuite en direct. */
export function openTableHost(game: SharedGame): Promise<TableHost> {
  const tableId = randomTableId();
  const peer = new Peer(peerIdFor(game, tableId), { debug: 0 });
  const channels = new Set<Channel>();
  const listeners = new Set<(channel: Channel) => void>();
  const host: TableHost = {
    tableId,
    link: inviteLink(game, tableId),
    onGuest: (listener) => {
      listeners.add(listener);
    },
    close: () => {
      for (const channel of [...channels]) channel.close();
      peer.destroy();
    },
  };

  peer.on('connection', (connection) => {
    connection.on('open', () => {
      const channel = new Channel(connection);
      channels.add(channel);
      channel.onClose(() => channels.delete(channel));
      for (const listener of [...listeners]) listener(channel);
    });
  });
  // Coupure avec le serveur de mise en relation : les invités déjà reliés le restent, on se réinscrit pour les suivants.
  peer.on('disconnected', () => {
    if (!peer.destroyed) peer.reconnect();
  });

  return new Promise((resolve, reject) => {
    peer.on('open', () => resolve(host));
    peer.on('error', (error) => {
      // Après l'ouverture, une erreur ne concerne qu'une connexion (invité parti) : la table continue.
      if (peer.open) return;
      peer.destroy();
      reject(new Error(describePeerError(error.type)));
    });
  });
}

/** Relie un invité à la table désignée par le lien. */
export function connectToTable(game: SharedGame, tableId: string): Promise<Channel> {
  return new Promise((resolve, reject) => {
    const peer = new Peer({ debug: 0 });
    let settled = false;
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      peer.destroy();
      reject(new Error(message));
    };
    const timeout = window.setTimeout(
      () => fail('La table ne répond pas : son créateur doit garder la page ouverte.'),
      CONNECT_TIMEOUT_MS,
    );

    peer.on('open', () => {
      const connection = peer.connect(peerIdFor(game, tableId), { reliable: true, serialization: 'json' });
      connection.on('open', () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        const channel = new Channel(connection);
        channel.onClose(() => peer.destroy());
        resolve(channel);
      });
    });
    peer.on('error', (error) => fail(describePeerError(error.type)));
  });
}
