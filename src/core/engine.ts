import type { PlayerId } from './player.js';
import type { Result } from './result.js';

/** Commande émise par un joueur humain (ou un bot) : toujours authentifiée par son PlayerId. */
export type PlayerCommand<T extends string> = {
  readonly type: T;
  readonly playerId: PlayerId;
};

/** Résultat d'une transition : le nouvel état + les événements à rejouer côté UI (animations, sons, log). */
export interface Transition<State, Event> {
  readonly state: State;
  readonly events: readonly Event[];
}

/** Regroupe les types d'un jeu pour garder un seul paramètre générique lisible. */
export interface GameTypes {
  readonly state: unknown;
  readonly command: { readonly type: string };
  readonly event: { readonly type: string };
  readonly view: unknown;
  readonly viewEvent: { readonly type: string };
  readonly legalActions: unknown;
}

/**
 * Contrat commun des moteurs. Implémenté par les Game Controllers (Étape 4).
 *
 * `apply` est une fonction PURE (state, command) → state' : aucune mutation, aucune I/O, aucun Date.now().
 * Le seul aléa (mélange) passe par la RandomSource injectée : avec une seed, une partie entière est rejouable.
 * Conséquences directes : replays, undo en debug, tests déterministes, et synchronisation serveur/client triviale.
 */
export interface GameEngine<T extends GameTypes> {
  /** Une action illégale renvoie une EngineError, jamais d'exception. */
  apply(state: T['state'], command: T['command']): Result<Transition<T['state'], T['event']>>;

  /** Ce que `playerId` peut faire maintenant : alimente directement l'activation des boutons de l'UI. */
  legalActions(state: T['state'], playerId: PlayerId): T['legalActions'];

  /** Vue anti-triche : masque les cartes cachées et l'ordre du sabot. `null` = spectateur. */
  project(state: T['state'], viewer: PlayerId | null): T['view'];

  /** Même filtrage pour le flux d'événements diffusé à chaque client. */
  projectEvent(event: T['event'], viewer: PlayerId | null): T['viewEvent'];
}

/** Table de verrouillage : pour chaque commande, les phases où elle est recevable. Exhaustivité vérifiée à la compilation. */
export type PhaseGuard<Phase extends string, CommandType extends string> = {
  readonly [K in CommandType]: readonly Phase[];
};
