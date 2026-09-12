import { CryptoRandomSource, chips, playerId, type PlayerId } from '../src/core/index.js';
import {
  RacingController,
  STANDARD_RACING_RULES,
  betOdds,
  formatOdds,
  payoutOf,
  type Horse,
  type PlacedRaceBet,
  type RaceBetKind,
  type RaceBetSelection,
  type RacingCommand,
  type RacingFinishedPhase,
  type RacingState,
} from '../src/racing/index.js';
import { setCheatTarget } from './cheat-console.js';
import { DAILY_REFILL, claimDailyRefill, loadLedger, netOf, recordResult, saveBalance, startingBalance } from './money-ledger.js';
import { showAlmanac, silence, whisper } from './racing-effects.js';
import { RaceTrack } from './racing-track.js';
import {
  REFILL_DONE_MESSAGE,
  REFILL_USED_MESSAGE,
  escapeHtml,
  expectOk,
  formatChips,
  formatSigned,
  queryIn,
  refillButtonHtml,
  signClass,
} from './ui.js';

type Tone = 'info' | 'win' | 'loss' | 'error';
type SlipKind = 'GAGNANT' | 'PLACE' | 'TIERCE' | 'QUINTE';

const PLAYER: PlayerId = playerId('vous');
const RULES = STANDARD_RACING_RULES;
const RACE_DURATION_MS = 13_000;
const STAKE_PRESETS = [1, 5, 10, 25, 100] as const;
const PICKS: Readonly<Record<SlipKind, number>> = { GAGNANT: 1, PLACE: 1, TIERCE: 3, QUINTE: 5 };
const SLIP_LABELS: Readonly<Record<SlipKind, string>> = { GAGNANT: 'Simple Gagnant', PLACE: 'Simple Placé', TIERCE: 'Tiercé', QUINTE: 'Quinté' };
const GOING_LABELS = { BON: 'bon', SOUPLE: 'souple', LOURD: 'lourd' } as const;
const ORDINALS = ['1er', '2e', '3e', '4e', '5e', '6e', '7e', '8e', '9e', '10e', '11e', '12e'];

export const BET_LABELS: Readonly<Record<RaceBetKind, string>> = {
  GAGNANT: 'Simple Gagnant',
  PLACE: 'Simple Placé',
  TIERCE_ORDRE: 'Tiercé ordre',
  TIERCE_DESORDRE: 'Tiercé désordre',
  QUINTE_ORDRE: 'Quinté ordre',
  QUINTE_DESORDRE: 'Quinté désordre',
};

function selectionFor(kind: SlipKind, ordered: boolean, picked: readonly number[]): RaceBetSelection | null {
  if (picked.length !== PICKS[kind]) return null;
  switch (kind) {
    case 'GAGNANT':
    case 'PLACE':
      return { kind, horses: picked as unknown as readonly [number] };
    case 'TIERCE':
      return { kind: ordered ? 'TIERCE_ORDRE' : 'TIERCE_DESORDRE', horses: picked as unknown as readonly [number, number, number] };
    case 'QUINTE':
      return {
        kind: ordered ? 'QUINTE_ORDRE' : 'QUINTE_DESORDRE',
        horses: picked as unknown as readonly [number, number, number, number, number],
      };
  }
}

export function mountRacing(root: HTMLElement): () => void {
  const controller = new RacingController(new CryptoRandomSource());
  let state: RacingState = expectOk(controller.createSession(PLAYER, startingBalance('courses')));
  let message = 'Étudiez le programme, choisissez vos chevaux et pariez.';
  let tone: Tone = 'info';
  let slipKind: SlipKind = 'GAGNANT';
  let ordered = true;
  let picked: number[] = [];
  let stake = 10;
  let racing = false;
  let almanach = false;
  /** Solde affiché pendant la course, avant le paiement des gains. */
  let bankrollDuringRace: number | null = null;

  root.innerHTML = `
    <div class="game rc-game">
      <header class="topbar">
        <a class="back" href="#/">← Lobby</a>
        <h1>Courses Hippiques</h1>
        <div class="topbar-stats">
          <div class="bankroll">Bilan <strong data-ledger></strong></div>
          <div class="bankroll">Solde <strong data-bankroll></strong></div>
        </div>
      </header>
      <section class="rc-header"><div data-race-info></div><p class="message" data-message aria-live="polite"></p></section>
      <section class="rc-stadium" data-stadium></section>
      <div class="rc-layout">
        <section class="rc-card-panel"><table class="rc-runners" data-runners></table></section>
        <aside class="rc-slip" data-slip></aside>
      </div>
    </div>`;

  const ledgerEl = queryIn<HTMLElement>(root, '[data-ledger]');
  const bankrollEl = queryIn<HTMLElement>(root, '[data-bankroll]');
  const infoEl = queryIn<HTMLElement>(root, '[data-race-info]');
  const messageEl = queryIn<HTMLElement>(root, '[data-message]');
  const stadiumEl = queryIn<HTMLElement>(root, '[data-stadium]');
  const runnersEl = queryIn<HTMLElement>(root, '[data-runners]');
  const slipEl = queryIn<HTMLElement>(root, '[data-slip]');
  const track = new RaceTrack(stadiumEl);
  track.setField(state.card);

  const horseOf = (number: number): Horse | undefined => state.card.horses.find((horse) => horse.number === number);
  const horseLabel = (number: number): string => `N°${number} ${horseOf(number)?.name ?? ''}`;
  const betsOf = (current: RacingState): readonly PlacedRaceBet[] =>
    current.phase === 'BETTING' ? current.bets : current.settlements.map((settlement) => settlement.bet);
  const finishedState = (): RacingFinishedPhase | null => (state.phase === 'FINISHED' ? state : null);

  function apply(command: RacingCommand): boolean {
    const result = controller.apply(state, command);
    if (!result.ok) {
      [message, tone] = [result.error.message, 'error'];
      return false;
    }
    state = result.value.state;
    return true;
  }

  function runnersHtml(): string {
    const finished = racing ? null : finishedState();
    const rank = new Map(finished === null ? [] : finished.result.order.map((number, index) => [number, index]));
    const locked = state.phase !== 'BETTING' || racing;
    const combo = slipKind === 'TIERCE' || slipKind === 'QUINTE';
    const lastHeader = finished !== null ? 'Arrivée' : combo ? 'Sélection' : '';
    const rows = state.card.horses
      .map((horse) => {
        const odds = state.card.odds.find((entry) => entry.number === horse.number);
        const pickIndex = picked.indexOf(horse.number);
        const position = rank.get(horse.number);
        const oddsButton = (kind: 'GAGNANT' | 'PLACE', value: number | undefined): string =>
          value === undefined
            ? ''
            : `<button class="rc-odds ${!combo && slipKind === kind && pickIndex === 0 ? 'is-active' : ''}" data-action="QUICK" data-kind="${kind}" data-horse="${horse.number}" ${locked ? 'disabled' : ''}>${formatOdds(value)}</button>`;
        let last = '';
        if (position !== undefined) last = `<span class="rc-rank ${position < 3 ? 'is-podium' : ''}">${ORDINALS[position] ?? ''}</span>`;
        else if (combo) last = `<button class="rc-pick" data-action="PICK" data-horse="${horse.number}" ${locked ? 'disabled' : ''} aria-pressed="${pickIndex >= 0}">${pickIndex >= 0 ? pickIndex + 1 : '+'}</button>`;
        return `
          <tr class="${pickIndex >= 0 ? 'is-picked' : ''} ${position === 0 ? 'is-winner' : ''}">
            <td><span class="rc-silk" style="--silk:${horse.silk}">${horse.number}</span></td>
            <td class="rc-name"><strong>${escapeHtml(horse.name)}</strong><small>${escapeHtml(horse.jockey)} · forme ${escapeHtml(horse.form)}</small></td>
            <td>${oddsButton('GAGNANT', odds?.win)}</td>
            <td>${oddsButton('PLACE', odds?.place)}</td>
            <td>${last}</td>
          </tr>`;
      })
      .join('');
    return `<thead><tr><th>N°</th><th>Cheval · jockey · forme</th><th>Gagnant</th><th>Placé</th><th>${lastHeader}</th></tr></thead><tbody>${rows}</tbody>`;
  }

  function potentialText(): string {
    const selection = selectionFor(slipKind, ordered, picked);
    if (selection === null || state.phase !== 'BETTING') return `Choisissez ${PICKS[slipKind]} cheva${PICKS[slipKind] > 1 ? 'ux' : 'l'} dans le programme.`;
    const odds = betOdds(state.card, RULES, selection);
    const gain = Number.isSafeInteger(stake) && stake > 0 ? formatChips(payoutOf(chips(stake), odds)) : '—';
    return `Cote ${formatOdds(odds)} · gain potentiel ${gain} jetons`;
  }

  function betsHtml(bets: readonly PlacedRaceBet[], cancellable: boolean): string {
    if (bets.length === 0) return '<p class="rc-empty">Aucun pari sur cette course.</p>';
    return `<ul class="rc-bets">${bets
      .map(
        (bet) => `
          <li>
            <span><strong>${BET_LABELS[bet.kind]}</strong> ${bet.horses.join('-')}</span>
            <span class="rc-bet-meta">${formatChips(bet.stake)} × ${formatOdds(bet.odds)}</span>
            ${cancellable ? `<button class="rc-cancel" data-action="CANCEL" data-bet="${bet.id}" aria-label="Annuler ce pari">✕</button>` : ''}
          </li>`,
      )
      .join('')}</ul>`;
  }

  function slipHtml(): string {
    const finished = racing ? null : finishedState();
    if (finished !== null) {
      const lines = finished.settlements
        .map(
          (settlement) => `
            <li class="${settlement.won ? 'is-won' : 'is-lost'}">
              <span><strong>${BET_LABELS[settlement.bet.kind]}</strong> ${settlement.bet.horses.join('-')}</span>
              <span class="${signClass(settlement.net)}">${formatSigned(settlement.net)}</span>
            </li>`,
        )
        .join('');
      const podium = finished.result.order
        .slice(0, 5)
        .map((number, index) => `<li><span class="rc-rank ${index < 3 ? 'is-podium' : ''}">${ORDINALS[index]}</span>${escapeHtml(horseLabel(number))}</li>`)
        .join('');
      return `
        <h2>Arrivée officielle</h2>
        <ol class="rc-podium">${podium}</ol>
        ${finished.settlements.length > 0 ? `<ul class="rc-bets rc-settlements">${lines}</ul>` : '<p class="rc-empty">Vous n’aviez pas parié sur cette course.</p>'}
        <p class="rc-total">Bilan de la course <strong class="${signClass(finished.net)}">${formatSigned(finished.net)}</strong></p>
        <button class="btn primary" data-action="NEXT">Course suivante</button>`;
    }

    const bets = betsOf(state);
    const staked = bets.reduce((total, bet) => total + bet.stake, 0);
    if (racing) {
      return `<h2>Course en cours…</h2>${betsHtml(bets, false)}<p class="rc-total">Total misé <strong>${formatChips(staked)}</strong></p>`;
    }
    const combo = slipKind === 'TIERCE' || slipKind === 'QUINTE';
    const tabs = (Object.keys(SLIP_LABELS) as SlipKind[])
      .map((kind) => `<button class="rc-tab" data-action="KIND" data-kind="${kind}" aria-pressed="${kind === slipKind}">${SLIP_LABELS[kind]}</button>`)
      .join('');
    const picks =
      picked.length === 0
        ? ''
        : `<ol class="rc-picks">${picked.map((number) => `<li>${escapeHtml(horseLabel(number))}</li>`).join('')}</ol>`;
    const selection = selectionFor(slipKind, ordered, picked);
    const cannotBet = selection === null || state.player.bankroll < RULES.minStake;
    const rebuy = state.player.bankroll + staked < RULES.minStake ? refillButtonHtml('courses', '') : '';
    return `
      <h2>Bulletin de pari</h2>
      <div class="rc-tabs">${tabs}</div>
      ${combo ? `<div class="rc-order"><button class="rc-tab" data-action="ORDER" data-ordered="1" aria-pressed="${ordered}">Ordre</button><button class="rc-tab" data-action="ORDER" data-ordered="0" aria-pressed="${!ordered}">Désordre</button></div>` : ''}
      ${picks}
      <label class="rc-stake-label" for="rc-stake">Mise</label>
      <div class="rc-stake-row">
        ${STAKE_PRESETS.map((value) => `<button class="rc-preset" data-action="STAKE" data-value="${value}" aria-pressed="${value === stake}">${value}</button>`).join('')}
        <input id="rc-stake" type="number" min="1" step="1" inputmode="numeric" value="${stake}" data-stake>
      </div>
      <p class="rc-potential" data-potential>${escapeHtml(potentialText())}</p>
      <button class="btn primary" data-action="BET" ${cannotBet ? 'disabled' : ''}>Parier</button>
      ${betsHtml(bets, true)}
      <p class="rc-total">Total misé <strong>${formatChips(staked)}</strong></p>
      <button class="btn primary rc-start" data-action="START">Lancer la course 🏁</button>
      ${rebuy}`;
  }

  function render(): void {
    const current = state;
    const staked = current.phase === 'BETTING' ? current.bets.reduce((total, bet) => total + bet.stake, 0) : 0;
    saveBalance('courses', current.player.bankroll + staked);
    bankrollEl.textContent = formatChips(bankrollDuringRace ?? current.player.bankroll);
    const net = netOf(loadLedger().courses);
    ledgerEl.textContent = formatSigned(net);
    ledgerEl.className = signClass(net);
    messageEl.textContent = message;
    messageEl.dataset['tone'] = tone;
    const { card } = current;
    infoEl.innerHTML = `<h2>Course n°${card.raceNumber}</h2><p>${escapeHtml(card.hippodrome)} · ${formatChips(card.distance)} m · terrain ${GOING_LABELS[card.going]} · ${card.horses.length} partants</p>`;
    runnersEl.innerHTML = runnersHtml();
    slipEl.innerHTML = slipHtml();
  }

  function placeBet(): void {
    const selection = selectionFor(slipKind, ordered, picked);
    if (selection === null || racing) return;
    if (apply({ type: 'PLACE_BET', playerId: PLAYER, bet: selection, stake: chips(Math.max(0, stake)) })) {
      [message, tone] = [`Pari enregistré : ${BET_LABELS[selection.kind]} ${selection.horses.join('-')} pour ${formatChips(stake)} jetons.`, 'info'];
      picked = [];
    }
    render();
  }

  function startRace(): void {
    if (racing || state.phase !== 'BETTING') return;
    const betHorses = new Set(state.bets.flatMap((bet) => bet.horses));
    const hadBets = state.bets.length > 0;
    if (!apply({ type: 'START_RACE' })) {
      render();
      return;
    }
    const finished = finishedState();
    if (finished === null) return;
    // Le résultat est acquis dès le départ : quitter pendant la course ne change rien au bilan.
    if (hadBets) recordResult('courses', finished.net);
    const paid = finished.settlements.reduce((total, settlement) => total + settlement.payout, 0);
    bankrollDuringRace = finished.player.bankroll - paid;
    racing = true;
    [message, tone] = ['Les chevaux sont dans les stalles…', 'info'];
    render();

    track.run(finished.card, finished.result, {
      durationMs: RACE_DURATION_MS,
      fireHorse: (standings) => (almanach ? (standings.find((number) => betHorses.has(number)) ?? standings[0] ?? null) : null),
      onFinish: () => {
        racing = false;
        almanach = false;
        bankrollDuringRace = null;
        const winner = finished.result.order[0] ?? 0;
        if (!hadBets) [message, tone] = [`Victoire de ${horseLabel(winner)}.`, 'info'];
        else if (finished.net > 0) [message, tone] = [`Victoire de ${horseLabel(winner)} : vous gagnez ${formatChips(finished.net)} jetons !`, 'win'];
        else if (finished.net < 0) [message, tone] = [`Victoire de ${horseLabel(winner)} : vous perdez ${formatChips(-finished.net)} jetons.`, 'loss'];
        else [message, tone] = [`Victoire de ${horseLabel(winner)} : vous récupérez vos mises.`, 'info'];
        render();
      },
    });
  }

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('button[data-action]');
    if (button === null || button.disabled) return;
    const horse = Number(button.dataset['horse']);
    switch (button.dataset['action']) {
      case 'QUICK':
        slipKind = button.dataset['kind'] === 'PLACE' ? 'PLACE' : 'GAGNANT';
        picked = [horse];
        render();
        break;
      case 'PICK':
        if (picked.includes(horse)) picked = picked.filter((number) => number !== horse);
        else if (picked.length < PICKS[slipKind]) picked = [...picked, horse];
        else [message, tone] = [`${SLIP_LABELS[slipKind]} : ${PICKS[slipKind]} chevaux maximum. Retirez-en un d’abord.`, 'error'];
        render();
        break;
      case 'KIND': {
        const kind = button.dataset['kind'] as SlipKind;
        if (kind !== slipKind) picked = picked.slice(0, PICKS[kind]);
        slipKind = kind;
        render();
        break;
      }
      case 'ORDER':
        ordered = button.dataset['ordered'] === '1';
        render();
        break;
      case 'STAKE':
        stake = Number(button.dataset['value']);
        render();
        break;
      case 'BET':
        placeBet();
        break;
      case 'CANCEL':
        if (apply({ type: 'CANCEL_BET', playerId: PLAYER, betId: button.dataset['bet'] ?? '' })) [message, tone] = ['Pari annulé et remboursé.', 'info'];
        render();
        break;
      case 'START':
        startRace();
        break;
      case 'NEXT':
        if (apply({ type: 'NEXT_RACE' })) {
          picked = [];
          track.setField(state.card);
          [message, tone] = [`Course n°${state.card.raceNumber} : les paris sont ouverts.`, 'info'];
        }
        render();
        break;
      case 'REBUY':
        if (claimDailyRefill('courses')) {
          state = expectOk(controller.createSession(PLAYER, state.player.bankroll + DAILY_REFILL));
          picked = [];
          track.setField(state.card);
          [message, tone] = [REFILL_DONE_MESSAGE, 'win'];
        } else {
          [message, tone] = [REFILL_USED_MESSAGE, 'error'];
        }
        render();
        break;
    }
  }

  function onInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement) || !event.target.matches('[data-stake]')) return;
    stake = Math.floor(Number(event.target.value));
    for (const preset of slipEl.querySelectorAll<HTMLButtonElement>('[data-action="STAKE"]')) {
      preset.setAttribute('aria-pressed', String(Number(preset.dataset['value']) === stake));
    }
    const potential = slipEl.querySelector('[data-potential]');
    if (potential !== null) potential.textContent = potentialText();
  }

  setCheatTarget({
    games: ['courses'],
    getBalance: () => state.player.bankroll,
    setBalance: (_game, amount) => {
      if (racing) return 'La course est lancée : attendez l’arrivée.';
      state = { ...state, player: { ...state.player, bankroll: chips(amount) } };
      render();
      return null;
    },
    refresh: render,
    foresee: () => {
      const current = state;
      if (current.phase !== 'BETTING' || racing) return 'La course a déjà couru.';
      const [winner] = current.sealedResult.order;
      return winner === undefined ? 'Le brouillard couvre la piste.' : `Une voix vous souffle que ${horseLabel(winner)} franchira le poteau en premier.`;
    },
    runCode: (code) => {
      if (code !== 'almanach') return null;
      const current = state;
      if (current.phase !== 'BETTING' || racing) return 'L’almanach ne parle que des courses qui n’ont pas encore couru.';
      almanach = true;
      const podium = current.sealedResult.order.slice(0, 3);
      showAlmanac(
        stadiumEl,
        `Course n°${current.card.raceNumber} · ${current.card.hippodrome}`,
        podium.map((number, index) => `${ORDINALS[index]} : ${horseLabel(number)}`),
      );
      whisper(`Psst… ${podium.map((number) => `numéro ${number}, ${horseOf(number)?.name ?? ''}`).join(', puis ')}.`);
      return 'Almanach ouvert : l’arrivée du tiercé vous est chuchotée, et votre cheval de tête s’enflammera dans la dernière ligne droite.';
    },
  });

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  render();

  return () => {
    track.stop();
    silence();
    setCheatTarget(null);
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
  };
}
