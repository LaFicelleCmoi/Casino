import { DEFAULT_HOUSE, EMPTY_SERVICE, parseHouseRules, type HouseRules, type ServiceStats } from './blackjack-house.js';
import { cleanPlayerName } from './net/player-name.js';

/**
 * Poste du croupier, conservé dans le navigateur : règles de la maison, service en cours, cagnotte des pourboires,
 * total des pourboires reçus et noms des bots. Recharger la page ou revenir du lobby reprend là où on en était.
 */
export interface DealerSave {
  readonly house: HouseRules;
  /** Pourboires du service en cours. Ils font déjà partie du solde sauvegardé : c'est la part de ce solde qui leur revient. */
  readonly jar: number;
  /** Service en cours, sans sa note : un service noté n'est pas repris. */
  readonly service: ServiceStats;
  /** Tous les pourboires reçus depuis le premier service. */
  readonly lifetimeTips: number;
  /** Noms que prennent les bots en s'asseyant, dans l'ordre. */
  readonly botNames: readonly string[];
}

const SAVE_KEY = 'casino-engine:croupier:v1';

export const DEFAULT_BOT_NAMES: readonly string[] = Object.freeze([
  'Léa', 'Hugo', 'Nora', 'Malik', 'Inès', 'Sacha', 'Yanis', 'Zoé',
  'Jules', 'Maya', 'Noé', 'Lina', 'Adam', 'Rose', 'Ilyes', 'Chloé',
]);

export const EMPTY_DEALER_SAVE: DealerSave = Object.freeze({
  house: DEFAULT_HOUSE,
  jar: 0,
  service: EMPTY_SERVICE,
  lifetimeTips: 0,
  botNames: DEFAULT_BOT_NAMES,
});

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function parseService(raw: unknown): ServiceStats {
  if (typeof raw !== 'object' || raw === null) return EMPTY_SERVICE;
  const record = raw as Record<string, unknown>;
  const counts = ['rounds', 'tips', 'wagered', 'seatsFilled', 'deals', 'gestures', 'gestureMs'] as const;
  if (!counts.every((key) => isCount(record[key])) || !isAmount(record['bankNet']) || !isAmount(record['theo'])) return EMPTY_SERVICE;
  return Object.fromEntries([...counts, 'bankNet', 'theo'].map((key) => [key, record[key]])) as unknown as ServiceStats;
}

/** Noms relus du stockage : nettoyés, sans doublon ; la liste d'origine si rien d'utilisable. */
function parseBotNames(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return DEFAULT_BOT_NAMES;
  const names = uniqueNames(raw.filter((name): name is string => typeof name === 'string').map(cleanPlayerName));
  return names.length === 0 ? DEFAULT_BOT_NAMES : names;
}

export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.toLocaleLowerCase('fr');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Chaque champ est vérifié : un stockage abîmé ou d'une autre version ne fait perdre que le champ concerné. */
export function parseDealerSave(raw: unknown): DealerSave {
  if (typeof raw !== 'object' || raw === null) return EMPTY_DEALER_SAVE;
  const record = raw as Record<string, unknown>;
  return {
    house: parseHouseRules(record['house']) ?? DEFAULT_HOUSE,
    jar: isCount(record['jar']) ? record['jar'] : 0,
    service: parseService(record['service']),
    lifetimeTips: isCount(record['lifetimeTips']) ? record['lifetimeTips'] : 0,
    botNames: parseBotNames(record['botNames']),
  };
}

export function loadDealerSave(): DealerSave {
  try {
    return parseDealerSave(JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null'));
  } catch {
    return EMPTY_DEALER_SAVE;
  }
}

export function saveDealerSave(save: DealerSave): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Stockage indisponible : le poste vaut pour la page en cours.
  }
}
