import type { Card, RandomSource } from '../src/core/index.js';
import { cardValue, scoreHand, type BlackjackPlayerActionType, type BlackjackRules, type PlayerHand } from '../src/blackjack/index.js';

/** Coups de jeu d'un bot : jamais de mise ni de siège pendant son tour. */
export type BotMove = Extract<BlackjackPlayerActionType, 'HIT' | 'STAND' | 'DOUBLE_DOWN' | 'SPLIT' | 'SURRENDER'>;

/** Mises d'un bot en multiples du minimum de table : 10 · 25 · 50 · 100 sur une table à 10. */
const BOT_BET_STEPS = [1, 2.5, 5, 10] as const;

/**
 * Mise d'un bot : un multiple du minimum qu'il peut couvrir, ou le minimum s'il est à court ; null s'il ne peut plus
 * jouer. L'appétit (règles de la maison) resserre les mises vers le bas sur une table serrée, vers le haut sur une
 * table généreuse.
 */
export function chooseBotBet(bankroll: number, rules: BlackjackRules, rng: RandomSource, appetite = 1): number | null {
  const affordable = BOT_BET_STEPS.map((step) => Math.round(rules.minBet * step)).filter(
    (amount) => amount >= rules.minBet && amount <= Math.min(bankroll, rules.maxBet),
  );
  if (affordable.length === 0) return bankroll >= rules.minBet ? rules.minBet : null;
  const count = Math.max(1, Math.min(affordable.length, Math.round(affordable.length * Math.min(1, appetite))));
  let index = rng.nextInt(count);
  if (appetite > 1.15) index = Math.max(index, rng.nextInt(count));
  return affordable[index] ?? rules.minBet;
}

/** Carte visible du croupier pour la stratégie : l'As compte 11. */
const upValue = (card: Card): number => (card.rank === 'A' ? 11 : cardValue(card));

/**
 * Stratégie de base simplifiée (S17, sabot de 6 jeux) : les bots jouent comme un joueur prudent et informé,
 * sans compter les cartes. Un coup préféré mais interdit retombe sur le suivant, puis sur « rester ».
 */
export function chooseBotMove(hand: PlayerHand, dealerUp: Card, legal: readonly BlackjackPlayerActionType[]): BotMove {
  const up = upValue(dealerUp);
  const pick = (...preferences: BotMove[]): BotMove => preferences.find((move) => legal.includes(move)) ?? (legal.includes('STAND') ? 'STAND' : 'HIT');

  const [first, second] = hand.cards;
  if (legal.includes('SPLIT') && first !== undefined && second !== undefined) {
    const pair = first.rank === 'A' ? 11 : cardValue(first);
    if (pair === 11 || pair === 8) return 'SPLIT';
    if (pair === 9 && up !== 7 && up <= 9) return 'SPLIT';
    if ((pair === 2 || pair === 3 || pair === 7) && up <= 7) return 'SPLIT';
    if (pair === 6 && up <= 6) return 'SPLIT';
  }

  const { total, isSoft } = scoreHand(hand);
  if (isSoft) {
    if (total >= 19) return pick('STAND');
    if (total === 18) return up >= 9 ? pick('HIT', 'STAND') : up >= 3 && up <= 6 ? pick('DOUBLE_DOWN', 'STAND') : pick('STAND');
    return up >= 4 && up <= 6 ? pick('DOUBLE_DOWN', 'HIT') : pick('HIT');
  }
  if (total >= 17) return pick('STAND');
  if (total >= 13) return up <= 6 ? pick('STAND') : pick('HIT');
  if (total === 12) return up >= 4 && up <= 6 ? pick('STAND') : pick('HIT');
  if (total === 11) return pick('DOUBLE_DOWN', 'HIT');
  if (total === 10) return up <= 9 ? pick('DOUBLE_DOWN', 'HIT') : pick('HIT');
  if (total === 9) return up >= 3 && up <= 6 ? pick('DOUBLE_DOWN', 'HIT') : pick('HIT');
  return pick('HIT');
}
