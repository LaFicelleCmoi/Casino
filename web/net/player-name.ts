/** Pseudo montré aux autres joueurs d'une table partagée, mémorisé dans le navigateur. */

const NAME_KEY = 'casino-engine:pseudo:v1';
const MAX_NAME_LENGTH = 16;
export const DEFAULT_PLAYER_NAME = 'Joueur';

/** Texte court sur une seule ligne, jamais vide : un invité ne choisit pas ce que les autres voient s'afficher. */
export function cleanPlayerName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_PLAYER_NAME;
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return name === '' ? DEFAULT_PLAYER_NAME : name;
}

export function loadPlayerName(): string {
  try {
    return cleanPlayerName(localStorage.getItem(NAME_KEY));
  } catch {
    return DEFAULT_PLAYER_NAME;
  }
}

export function savePlayerName(raw: string): string {
  const name = cleanPlayerName(raw);
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Stockage indisponible : le pseudo vaut pour la page en cours.
  }
  return name;
}
