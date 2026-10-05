import Peer, { type DataConnection } from 'peerjs';

/** Jeux jouables à plusieurs via un lien d'invitation. */
export type SharedGame = 'blackjack' | 'holdem';

/** Joueurs réels par table partagée, créateur compris. */
export const MAX_TABLE_PLAYERS = 8;

const PEER_PREFIX = 'casino-engine-';
const HEARTBEAT_MS = 4_000;
const SILENCE_LIMIT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 20_000;
/** Délai laissé à la connexion directe avant de passer par le relais. */
const DIRECT_GRACE_MS = 6_000;
const RELAY_HELLO_MS = 1_500;
const TABLE_ID_PATTERN = /^[a-z0-9]{8,32}$/;

/**
 * STUN seulement : les relais TURN gratuits sans compte sont tous hors service. Quand la connexion directe échoue
 * (box ou pare-feu stricts entre deux machines), les messages passent par le relais du serveur de mise en relation.
 */
const PEER_OPTIONS = {
  debug: 0,
  config: {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    ],
    sdpSemantics: 'unified-plan',
  },
};

/**
 * Relais de secours : le serveur PeerJS transmet à son destinataire un message CANDIDATE bien formé, champs en plus
 * compris. On y glisse nos messages, via le WebSocket déjà ouvert vers le serveur : ça passe partout où la mise en
 * relation passe, sans compte ni serveur à nous. Le serveur exige un candidat non vide et coupe au-delà d'environ
 * 16 Ko par message : les messages sont donc découpés en morceaux.
 */
const RELAY_MESSAGE_TYPE = 'CANDIDATE';
const RELAY_KEY = 'casinoRelay';
const RELAY_CONNECTION_ID = 'dc_casinorelay';
const RELAY_ENVELOPE = {
  candidate: { candidate: 'candidate:0 1 udp 1 0.0.0.0 9 typ host', sdpMid: '0', sdpMLineIndex: 0 },
  type: 'data',
  connectionId: RELAY_CONNECTION_ID,
};
/** En caractères : même tout en accents, un morceau reste loin de la limite du serveur. */
const RELAY_CHUNK_CHARS = 4_000;

type RelayFrame =
  | { readonly relay: 'hello' | 'welcome' | 'bye' }
  | { readonly relay: 'data'; readonly chunk: string; readonly more: boolean };

function readFrame(message: unknown): { readonly src: string; readonly frame: RelayFrame } | null {
  if (typeof message !== 'object' || message === null) return null;
  const { type, src, payload } = message as { readonly type?: unknown; readonly src?: unknown; readonly payload?: unknown };
  if (type !== RELAY_MESSAGE_TYPE || typeof src !== 'string' || typeof payload !== 'object' || payload === null) return null;
  const frame = (payload as Record<string, unknown>)[RELAY_KEY];
  if (typeof frame !== 'object' || frame === null) return null;
  const { relay, chunk, more } = frame as { readonly relay?: unknown; readonly chunk?: unknown; readonly more?: unknown };
  if (relay === 'hello' || relay === 'welcome' || relay === 'bye') return { src, frame: { relay } };
  if (relay === 'data' && typeof chunk === 'string' && typeof more === 'boolean') return { src, frame: { relay, chunk, more } };
  return null;
}

function sendFrame(peer: Peer, dst: string, frame: RelayFrame): void {
  peer.socket.send({ type: RELAY_MESSAGE_TYPE, dst, payload: { ...RELAY_ENVELOPE, [RELAY_KEY]: frame } });
}

function onFrames(peer: Peer, listener: (src: string, frame: RelayFrame) => void): () => void {
  const handler = (message: unknown): void => {
    const parsed = readFrame(message);
    if (!parsed) return;
    // PeerJS a mis ce faux candidat de côté pour une connexion qui n'existera jamais : on le jette.
    (peer as unknown as { readonly _lostMessages?: Map<string, unknown> })._lostMessages?.delete(RELAY_CONNECTION_ID);
    listener(parsed.src, parsed.frame);
  };
  peer.socket.on('message', handler);
  return () => peer.socket.off('message', handler);
}

/**
 * Se réinscrit auprès du serveur après une coupure (le relais en dépend), et renvoie la fonction de fermeture.
 * destroy() émet « disconnected » avant de marquer le pair détruit : sans ce drapeau, on relancerait une inscription
 * qui resterait ouverte.
 */
function keepRegistered(peer: Peer): () => void {
  let closing = false;
  peer.on('disconnected', () => {
    if (closing || peer.destroyed) return;
    try {
      peer.reconnect();
    } catch {
      // Déjà en cours de reconnexion : rien à faire.
    }
  });
  return () => {
    closing = true;
    peer.destroy();
  };
}

/** Transport brut d'un canal : connexion WebRTC directe, ou relais par le serveur de mise en relation. */
interface Link {
  send(message: unknown): void;
  onData(listener: (data: unknown) => void): void;
  onEnd(listener: () => void): void;
  close(): void;
}

function directLink(connection: DataConnection): Link {
  return {
    send: (message) => void connection.send(message),
    onData: (listener) => connection.on('data', listener),
    onEnd: (listener) => {
      connection.on('close', listener);
      connection.on('error', listener);
    },
    close: () => connection.close(),
  };
}

function relayLink(peer: Peer, remote: string): Link {
  const dataListeners = new Set<(data: unknown) => void>();
  const endListeners = new Set<() => void>();
  let ended = false;
  let pending = '';
  const end = (): void => {
    if (ended) return;
    ended = true;
    stop();
    for (const listener of [...endListeners]) listener();
  };
  const stop = onFrames(peer, (src, frame) => {
    if (src !== remote) return;
    if (frame.relay === 'bye') end();
    if (frame.relay !== 'data') return;
    // Le WebSocket garde l'ordre : on recolle les morceaux jusqu'au dernier.
    pending += frame.chunk;
    if (frame.more) return;
    const text = pending;
    pending = '';
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return; // Morceau perdu pendant une coupure avec le serveur : message abandonné.
    }
    for (const listener of [...dataListeners]) listener(data);
  });
  return {
    send: (message) => {
      const text = JSON.stringify(message) ?? 'null';
      let start = 0;
      do {
        const next = start + RELAY_CHUNK_CHARS;
        sendFrame(peer, remote, { relay: 'data', chunk: text.slice(start, next), more: next < text.length });
        start = next;
      } while (start < text.length);
    },
    onData: (listener) => dataListeners.add(listener),
    onEnd: (listener) => endListeners.add(listener),
    close: () => {
      if (!ended) sendFrame(peer, remote, { relay: 'bye' });
      end();
    },
  };
}

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
 * Canal fiable entre deux navigateurs (WebRTC direct ou relais). Un battement de cœur détecte en quelques secondes
 * un onglet fermé ou une coupure réseau, que WebRTC seul peut mettre longtemps à signaler.
 */
export class Channel {
  readonly #link: Link;
  readonly #messageListeners = new Set<(message: unknown) => void>();
  readonly #closeListeners = new Set<() => void>();
  readonly #heartbeat: number;
  #lastSeen = Date.now();
  #closed = false;

  constructor(link: Link) {
    this.#link = link;
    link.onData((data) => {
      this.#lastSeen = Date.now();
      if (isPing(data)) return;
      for (const listener of [...this.#messageListeners]) listener(data);
    });
    link.onEnd(() => this.close());
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
      this.#link.send(message);
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
    this.#link.close();
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

/**
 * Inscrit la table du créateur auprès du serveur de mise en relation PeerJS ; les invités s'y relient ensuite en
 * direct, ou par le relais quand leur réseau l'empêche.
 */
export function openTableHost(game: SharedGame): Promise<TableHost> {
  const tableId = randomTableId();
  const peer = new Peer(peerIdFor(game, tableId), PEER_OPTIONS);
  // Coupure avec le serveur de mise en relation : les invités directs restent reliés, on se réinscrit pour le relais et les suivants.
  const destroy = keepRegistered(peer);
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
      destroy();
    },
  };

  const admit = (channel: Channel): void => {
    channels.add(channel);
    channel.onClose(() => channels.delete(channel));
    for (const listener of [...listeners]) listener(channel);
  };

  peer.on('connection', (connection) => {
    connection.on('open', () => admit(new Channel(directLink(connection))));
  });
  // Invités relayés, par identifiant PeerJS : l'invité répète son « hello » jusqu'à notre réponse.
  const relayed = new Map<string, Channel>();
  onFrames(peer, (src, frame) => {
    if (frame.relay !== 'hello') return;
    sendFrame(peer, src, { relay: 'welcome' });
    if (relayed.has(src)) return;
    const channel = new Channel(relayLink(peer, src));
    relayed.set(src, channel);
    channel.onClose(() => relayed.delete(src));
    admit(channel);
  });

  return new Promise((resolve, reject) => {
    peer.on('open', () => resolve(host));
    peer.on('error', (error) => {
      // Après l'ouverture, une erreur ne concerne qu'une connexion (invité parti) : la table continue.
      if (peer.open) return;
      destroy();
      reject(new Error(describePeerError(error.type)));
    });
  });
}

/**
 * Relie un invité à la table désignée par le lien : en direct si le réseau le permet, sinon par le relais du serveur
 * de mise en relation (box ou pare-feu stricts entre deux machines).
 */
export function connectToTable(game: SharedGame, tableId: string): Promise<Channel> {
  return new Promise((resolve, reject) => {
    const hostId = peerIdFor(game, tableId);
    const peer = new Peer(PEER_OPTIONS);
    const destroy = keepRegistered(peer);
    let settled = false;
    let direct: DataConnection | null = null;
    let relaying = false;
    let stopFrames = (): void => {};
    let helloTimer = 0;
    let graceTimer = 0;
    const cleanup = (): void => {
      settled = true;
      window.clearTimeout(timeout);
      window.clearTimeout(graceTimer);
      window.clearInterval(helloTimer);
      stopFrames();
    };
    const fail = (message: string): void => {
      if (settled) return;
      cleanup();
      destroy();
      reject(new Error(message));
    };
    const succeed = (link: Link): void => {
      if (settled) return;
      cleanup();
      const channel = new Channel(link);
      channel.onClose(destroy);
      resolve(channel);
    };
    const timeout = window.setTimeout(
      () => fail('La table ne répond pas : son créateur doit garder la page ouverte.'),
      CONNECT_TIMEOUT_MS,
    );

    // La connexion directe n'aboutit pas : on l'abandonne et on se présente à la table par le relais.
    const useRelay = (): void => {
      if (settled || relaying) return;
      relaying = true;
      window.clearTimeout(graceTimer);
      direct?.close();
      stopFrames = onFrames(peer, (src, frame) => {
        if (src === hostId && frame.relay === 'welcome') succeed(relayLink(peer, hostId));
      });
      const hello = (): void => sendFrame(peer, hostId, { relay: 'hello' });
      hello();
      helloTimer = window.setInterval(hello, RELAY_HELLO_MS);
    };

    peer.on('open', () => {
      if (settled || direct || relaying) return;
      const connection = peer.connect(hostId, { reliable: true, serialization: 'json' });
      direct = connection;
      connection.on('iceStateChanged', (state) => {
        if (state === 'failed' || state === 'disconnected' || state === 'closed') useRelay();
      });
      connection.on('open', () => {
        if (!relaying) succeed(directLink(connection));
      });
      graceTimer = window.setTimeout(useRelay, DIRECT_GRACE_MS);
    });
    peer.on('error', (error) => {
      if (error.type === 'webrtc') useRelay();
      else fail(describePeerError(error.type));
    });
  });
}
