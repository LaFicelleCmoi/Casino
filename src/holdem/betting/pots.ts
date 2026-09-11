import {
  addChips,
  chips,
  invariant,
  splitEvenly,
  subtractChips,
  type Chips,
  type SeatIndex,
} from '../../core/index.js';
import type { EvaluatedHand } from '../types/hand-rank.js';
import type { Pot, PotAward, PotShare } from '../types/pot.js';
import type { PokerSeat } from '../types/state.js';

export interface PotContribution {
  readonly seatIndex: SeatIndex;
  readonly amount: Chips;
  /** Un joueur foldé alimente les pots mais n'en gagne aucun. */
  readonly folded: boolean;
  readonly allIn: boolean;
}

export function contributionsOf(seats: readonly (PokerSeat | null)[]): PotContribution[] {
  return seats.flatMap((seat): PotContribution[] =>
    seat === null || seat.totalCommitted === 0
      ? []
      : [
          {
            seatIndex: seat.seatIndex,
            amount: seat.totalCommitted,
            folded: seat.status === 'FOLDED',
            allIn: seat.status === 'ALL_IN',
          },
        ],
  );
}

export interface UncalledBetReturn {
  readonly seats: (PokerSeat | null)[];
  readonly returned: PotShare | null;
}

/**
 * La part d'une mise que personne n'a suivie revient à son auteur AVANT la construction des pots.
 * Ex. : A mise 300, B est all-in pour 100 → 200 rendus à A. Sans cela, A formerait un side pot contre lui-même.
 */
export function returnUncalledBet(seats: readonly (PokerSeat | null)[]): UncalledBetReturn {
  const bettors = seats
    .filter((seat): seat is PokerSeat => seat !== null && seat.streetBet > 0)
    .sort((a, b) => b.streetBet - a.streetBet);
  const [top, second] = bettors;
  const excess = top === undefined ? 0 : top.streetBet - (second?.streetBet ?? 0);

  if (top === undefined || excess === 0) {
    return { seats: [...seats], returned: null };
  }

  const amount = chips(excess);
  const refunded: PokerSeat = {
    ...top,
    stack: addChips(top.stack, amount),
    streetBet: subtractChips(top.streetBet, amount),
    totalCommitted: subtractChips(top.totalCommitted, amount),
    status: top.status === 'ALL_IN' ? 'IN_HAND' : top.status,
  };
  return {
    seats: seats.map((seat) => (seat?.seatIndex === top.seatIndex ? refunded : seat)),
    returned: { seatIndex: top.seatIndex, amount },
  };
}

/**
 * Découpe les contributions en pot principal + side pots.
 * Paliers = montants des joueurs all-in + contribution maximale d'un joueur non foldé.
 * Chaque pot i contient, pour chaque joueur, la tranche de sa contribution comprise entre les paliers i-1 et i.
 *
 * À appeler sur des contributions égalisées : fin de street (après returnUncalledBet) ou showdown.
 * Pendant une street, passer les contributions des streets précédentes (totalCommitted - streetBet).
 */
export function buildPots(contributions: readonly PotContribution[]): Pot[] {
  const live = contributions.filter((c) => !c.folded);
  const total = contributions.reduce((sum, c) => sum + c.amount, 0);
  if (total === 0) return [];
  invariant(live.length > 0, 'Des jetons sont engagés mais plus aucun joueur ne peut les gagner');

  const topLevel = Math.max(...live.map((c) => c.amount));
  const levels = [...new Set([...live.filter((c) => c.allIn).map((c) => c.amount), topLevel])]
    .filter((level) => level > 0)
    .sort((a, b) => a - b);

  const pots: Pot[] = [];
  let previous = 0;
  for (const level of levels) {
    const amount = contributions.reduce(
      (sum, c) => sum + Math.min(c.amount, level) - Math.min(c.amount, previous),
      0,
    );
    pots.push({
      amount: chips(amount),
      eligibleSeats: live.filter((c) => c.amount >= level).map((c) => c.seatIndex),
    });
    previous = level;
  }

  // Argent mort d'un joueur foldé au-delà du dernier palier : versé au dernier pot.
  const allocated = pots.reduce((sum, pot) => sum + pot.amount, 0);
  const last = pots.at(-1);
  if (last !== undefined && total > allocated) {
    pots[pots.length - 1] = { ...last, amount: chips(last.amount + total - allocated) };
  }
  return pots;
}

/** Parts égales ; chaque jeton indivisible va, un par un, aux gagnants dans l'ordre de priorité fourni. */
export function splitPot(amount: Chips, winnersInPriorityOrder: readonly SeatIndex[]): PotShare[] {
  const { share, remainder } = splitEvenly(amount, winnersInPriorityOrder.length);
  return winnersInPriorityOrder.map((seatIndex, position) => ({
    seatIndex,
    amount: position < remainder ? addChips(share, chips(1)) : share,
  }));
}

/**
 * Attribue chaque pot à la meilleure main parmi ses éligibles (égalité ⇒ partage).
 * @param hands mains évaluées au showdown (inutile pour un pot à un seul éligible)
 * @param oddChipOrder priorité des jetons indivisibles : sièges dans le sens horaire à partir de la gauche du bouton
 */
export function awardPots(
  pots: readonly Pot[],
  hands: ReadonlyMap<SeatIndex, EvaluatedHand>,
  oddChipOrder: readonly SeatIndex[],
): PotAward[] {
  const priority = (seat: SeatIndex): number => {
    const position = oddChipOrder.indexOf(seat);
    invariant(position !== -1, `Siège ${seat} absent de l'ordre de distribution`);
    return position;
  };

  return pots.map((pot, potIndex): PotAward => {
    const [onlyContender] = pot.eligibleSeats;
    invariant(onlyContender !== undefined, `Pot ${potIndex} sans joueur éligible`);

    if (pot.eligibleSeats.length === 1) {
      return {
        potIndex,
        amount: pot.amount,
        winningHand: hands.get(onlyContender) ?? null,
        shares: [{ seatIndex: onlyContender, amount: pot.amount }],
      };
    }

    let bestScore = Number.NEGATIVE_INFINITY;
    let winners: SeatIndex[] = [];
    for (const seatIndex of pot.eligibleSeats) {
      const hand = hands.get(seatIndex);
      invariant(hand !== undefined, `Main manquante au showdown pour le siège ${seatIndex}`);
      if (hand.score > bestScore) {
        bestScore = hand.score;
        winners = [seatIndex];
      } else if (hand.score === bestScore) {
        winners.push(seatIndex);
      }
    }

    const ordered = winners.sort((a, b) => priority(a) - priority(b));
    const [firstWinner] = ordered;
    invariant(firstWinner !== undefined, `Pot ${potIndex} sans gagnant`);
    return {
      potIndex,
      amount: pot.amount,
      winningHand: hands.get(firstWinner) ?? null,
      shares: splitPot(pot.amount, ordered),
    };
  });
}
