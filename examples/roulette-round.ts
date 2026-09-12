/**
 * Main : simule un tour complet de Roulette Européenne en console, sans aucune interface graphique.
 *
 *   npm run demo:roulette          tirage cryptographique
 *   npm run demo:roulette -- 42    tirage rejouable avec la seed « 42 »
 */
import { webcrypto } from 'node:crypto';
import { CryptoRandomSource, SeededRandomSource, chips, playerId, type RandomSource } from '../src/core/index.js';
import {
  RouletteController,
  STANDARD_ROULETTE_RULES,
  type BetId,
  type BetSelection,
  type PocketColor,
  type RouletteCommand,
  type RouletteEvent,
  type RouletteState,
  type SpinOutcome,
} from '../src/roulette/index.js';

const CHIP = 10;
const BUY_IN = 1_000;
const COLOR_LABELS: Readonly<Record<PocketColor, string>> = { GREEN: 'vert', RED: 'rouge', BLACK: 'noir' };

const seed = process.argv[2];
// Web Crypto de Node passé explicitement : fonctionne même là où `globalThis.crypto` n'est pas exposé.
const rng: RandomSource = seed === undefined ? new CryptoRandomSource(webcrypto) : new SeededRandomSource(seed);
const controller = new RouletteController(rng);
const alice = playerId('alice');

const fmt = (amount: number): string => amount.toLocaleString('fr-FR');
const signed = (amount: number): string => (amount > 0 ? `+${fmt(amount)}` : amount < 0 ? `−${fmt(-amount)}` : '0');
const labelOf = (betId: BetId): string => controller.catalog.get(betId)?.label ?? betId;

function describeOutcome(outcome: SpinOutcome): string {
  if (outcome.color === 'GREEN') return '0 vert : toutes les mises externes sont perdues';
  const parity = outcome.parity === 'EVEN' ? 'pair' : 'impair';
  const range = outcome.range === 'LOW' ? 'manque' : 'passe';
  return `${outcome.number} ${COLOR_LABELS[outcome.color]} (${parity}, ${range}, douzaine ${outcome.dozen}, colonne ${outcome.column})`;
}

function log(event: RouletteEvent): void {
  switch (event.type) {
    case 'PLAYER_SAT_DOWN':
      console.log(`Alice s'assoit avec ${fmt(event.bankroll)} jetons.`);
      break;
    case 'BET_PLACED':
      console.log(`  • ${fmt(event.amount)} jetons sur ${labelOf(event.betId)}`);
      break;
    case 'BETS_CLOSED':
      console.log('\n« Rien ne va plus. »');
      break;
    case 'WHEEL_SPUN':
      console.log(`La bille s'arrête sur le ${describeOutcome(event.outcome)}.\n`);
      break;
    case 'SEAT_SETTLED': {
      const { settlement } = event;
      for (const bet of settlement.bets) {
        const verdict = bet.won ? `gagnée, rendu ${fmt(bet.returned)}` : 'perdue';
        console.log(`  ${bet.label.padEnd(10)} mise ${fmt(bet.stake)} → ${verdict} (${signed(bet.net)})`);
      }
      console.log(`\nBilan du tour : ${signed(settlement.net)} jetons`);
      console.log(`Solde final   : ${fmt(settlement.bankrollAfter)} jetons`);
      break;
    }
    default:
      break;
  }
}

function run(state: RouletteState, command: RouletteCommand): RouletteState {
  const result = controller.apply(state, command);
  if (!result.ok) throw result.error;
  result.value.events.forEach(log);
  return result.value.state;
}

const placeChip = (state: RouletteState, bet: BetSelection): RouletteState =>
  run(state, { type: 'PLACE_BET', playerId: alice, bet, amount: chips(CHIP) });

const created = controller.createTable(STANDARD_ROULETTE_RULES);
if (!created.ok) throw created.error;

console.log(`Roulette Européenne · ${seed === undefined ? 'tirage cryptographique' : `seed « ${seed} »`}\n`);
let state: RouletteState = run(created.value, {
  type: 'SIT_DOWN',
  playerId: alice,
  seatIndex: 0,
  displayName: 'Alice',
  buyIn: chips(BUY_IN),
});

console.log('\n« Faites vos jeux. »');
state = placeChip(state, { kind: 'RED' });
state = placeChip(state, { kind: 'STRAIGHT', numbers: [17] });

// Le moteur de mises refuse toute position absente du tapis : 1 et 5 ne sont pas adjacents.
const refused = controller.apply(state, {
  type: 'PLACE_BET',
  playerId: alice,
  bet: { kind: 'SPLIT', numbers: [1, 5] },
  amount: chips(CHIP),
});
if (!refused.ok) console.log(`  ✗ ${refused.error.message} (${refused.error.code})`);
console.log(`  Solde après les mises : ${fmt(state.seats[0]?.bankroll ?? 0)} jetons`);

state = run(state, { type: 'CLOSE_BETS' });
run(state, { type: 'SPIN' });
