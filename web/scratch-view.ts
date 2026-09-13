import { CryptoRandomSource, chips, playerId, type PlayerId } from '../src/core/index.js';
import {
  POLE_POSITION_DUEL_MAX,
  SCRATCH_GAMES,
  SCRATCH_GAME_LIST,
  ScratchController,
  UNBEATABLE_LAP_TIME,
  formatAmount,
  formatLapTime,
  isTicketType,
  maxPrize,
  ticketCellIds,
  winProbability,
  type ScratchCell,
  type ScratchCommand,
  type ScratchState,
  type ScratchZone,
  type ScratchingPhase,
  type Ticket,
  type TicketTypeId,
} from '../src/scratch/index.js';
import { setCheatTarget, xrayEnabled } from './cheat-console.js';
import { DAILY_REFILL, claimDailyRefill, loadLedger, netOf, recordResult, saveBalance, startingBalance } from './money-ledger.js';
import { burnout, playTireScreech } from './scratch-effects.js';
import { ScratchSurface, TICKET_THEMES, lotsHtml, markLetter, showEvaluation, ticketHtml } from './scratch-ticket.js';
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

const PLAYER: PlayerId = playerId('vous');
/** Codes de triche du Pole Position Jackpot. */
const RACE_FIX_CODES: ReadonlySet<string> = new Set(['drszone', 'v12turbo']);
const CHEAPEST_TICKET = Math.min(...SCRATCH_GAME_LIST.map((game) => game.price));

/** Course truquée : « Votre Temps » affiche 00:00:01 et la coupe cache le gain maximum de la zone 2. */
function fixRace(zones: readonly ScratchZone[]): readonly ScratchZone[] {
  return zones.map((zone) =>
    zone.id !== 'duel'
      ? zone
      : {
          ...zone,
          groups: zone.groups.map((cellGroup) => ({
            ...cellGroup,
            cells: cellGroup.cells.map((cell): ScratchCell => {
              if (cellGroup.id === 'vous') return { ...cell, value: UNBEATABLE_LAP_TIME, label: formatLapTime(UNBEATABLE_LAP_TIME) };
              if (cellGroup.id === 'coupe') return { ...cell, amount: chips(POLE_POSITION_DUEL_MAX), label: formatAmount(POLE_POSITION_DUEL_MAX) };
              return cell;
            }),
          })),
        },
  );
}

const cellsOfTicket = (ticket: Ticket): ScratchCell[] =>
  ticket.zones.flatMap((zone) => zone.groups.flatMap((cellGroup) => cellGroup.cells));

export function mountScratch(root: HTMLElement): () => void {
  const controller = new ScratchController(new CryptoRandomSource());
  let state: ScratchState = expectOk(controller.createSession(PLAYER, startingBalance('grattage')));
  let message = 'Choisissez un ticket, grattez à la souris ou au doigt.';
  let tone: Tone = 'info';
  let showCatalog = true;
  let busy = false;
  let disposed = false;
  let surface: ScratchSurface | null = null;
  let renderedSerial: string | null = null;
  let revealedCells = new Set<string>();
  let evaluationShown = false;
  let resizeTimer: number | undefined;

  root.innerHTML = `
    <div class="game sc-game">
      <header class="topbar">
        <a class="back" href="#/">← Lobby</a>
        <h1>Tickets à gratter</h1>
        <div class="topbar-stats">
          <div class="bankroll">Bilan <strong data-ledger></strong></div>
          <div class="bankroll">Solde <strong data-bankroll></strong></div>
        </div>
      </header>
      <p class="message sc-message" data-message aria-live="polite"></p>
      <div data-stage></div>
    </div>`;

  const ledgerEl = queryIn<HTMLElement>(root, '[data-ledger]');
  const bankrollEl = queryIn<HTMLElement>(root, '[data-bankroll]');
  const messageEl = queryIn<HTMLElement>(root, '[data-message]');
  const stageEl = queryIn<HTMLElement>(root, '[data-stage]');

  function apply(command: ScratchCommand): boolean {
    const before = state.phase;
    const result = controller.apply(state, command);
    if (!result.ok) {
      [message, tone] = [result.error.message, 'error'];
      return false;
    }
    state = result.value.state;
    const current = state;
    if (before === 'SCRATCHING' && current.phase === 'REVEALED') {
      const { evaluation, price } = current.ticket;
      recordResult('grattage', evaluation.total - price);
      [message, tone] =
        evaluation.total > 0 ? [`Gagné ! ${formatChips(evaluation.total)} jetons crédités.`, 'win'] : ['Perdu… ce ticket ne rapporte rien.', 'loss'];
    }
    return true;
  }

  function buy(type: TicketTypeId): void {
    if (busy) return;
    if (apply({ type: 'BUY_TICKET', playerId: PLAYER, ticketType: type })) {
      showCatalog = false;
      [message, tone] = [`Ticket ${SCRATCH_GAMES[type].name} acheté : à vous de gratter !`, 'info'];
    }
    sync();
  }

  function onCellScratched(cellId: string): void {
    if (busy || state.phase !== 'SCRATCHING' || state.ticket.scratched.includes(cellId)) return;
    apply({ type: 'SCRATCH_CELL', playerId: PLAYER, cellId });
    sync();
  }

  function catalogHtml(): string {
    const cards = SCRATCH_GAME_LIST.map((game) => {
      const odds = (1 / winProbability(game.prizes)).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
      const affordable = state.player.bankroll >= game.price;
      return `
        <article class="sc-card sc-theme-${TICKET_THEMES[game.type]}">
          <div class="sc-card-inner">
            <span class="sc-card-price">${formatChips(game.price)} jeton${game.price > 1 ? 's' : ''}</span>
            <h2>${escapeHtml(game.name)}</h2>
            <p class="sc-card-tagline">${escapeHtml(game.tagline)}</p>
            <dl class="sc-card-facts">
              <div><dt>Gain max</dt><dd>${formatChips(maxPrize(game.prizes))}</dd></div>
              <div><dt>Chances</dt><dd>1 sur ${odds}</dd></div>
            </dl>
            ${lotsHtml(game)}
            <button class="btn primary" data-action="BUY" data-type="${game.type}" ${affordable ? '' : 'disabled'}>Acheter</button>
          </div>
        </article>`;
    }).join('');
    const rebuy =
      state.player.bankroll < CHEAPEST_TICKET
        ? `<div class="sc-rebuy"><p>Plus assez de jetons pour un ticket.</p>${refillButtonHtml('grattage')}</div>`
        : '';
    return `${rebuy}<div class="sc-catalog">${cards}</div>`;
  }

  function actionsHtml(ticket: Ticket): string {
    const game = SCRATCH_GAMES[ticket.type];
    if (state.phase === 'SCRATCHING') {
      const total = ticketCellIds(ticket).length;
      const done = ticket.scratched.length;
      return `
        <p class="sc-progress">${done} / ${total} cases grattées</p>
        <div class="sc-progress-bar"><span style="width:${Math.round((done / total) * 100)}%"></span></div>
        <button class="btn primary" data-action="SCRATCH_ALL">Tout gratter</button>
        <p class="sc-tip">Grattez à la souris ou au doigt, ou utilisez « Gratter » sur chaque jeu.</p>
        ${lotsHtml(game)}`;
    }
    const affordable = state.player.bankroll >= game.price;
    return `
      <button class="btn primary" data-action="BUY" data-type="${ticket.type}" ${affordable ? '' : 'disabled'}>
        Racheter un ${escapeHtml(game.name)} · ${formatChips(game.price)}
      </button>
      <button class="btn ghost" data-action="CATALOG">Tous les tickets</button>
      ${state.player.bankroll < CHEAPEST_TICKET ? refillButtonHtml('grattage', '') : ''}
      ${lotsHtml(game)}`;
  }

  function buildTicket(ticket: Ticket): void {
    surface?.destroy();
    stageEl.innerHTML = `<div class="sc-stage">${ticketHtml(ticket, SCRATCH_GAMES[ticket.type].name)}<aside class="sc-actions" data-actions></aside></div>`;
    const ticketEl = queryIn<HTMLElement>(stageEl, '[data-ticket]');
    surface = new ScratchSurface(ticketEl, onCellScratched);
    surface.paint();
    renderedSerial = ticket.serial;
    revealedCells = new Set();
    evaluationShown = false;
  }

  function sync(): void {
    const pending = state.phase === 'SCRATCHING' ? state.ticket.evaluation.total : 0;
    // Le gain est imprimé dès l'achat : il fait partie du solde sauvegardé même si l'onglet se ferme avant la fin.
    saveBalance('grattage', state.player.bankroll + pending);
    bankrollEl.textContent = formatChips(state.player.bankroll);
    const net = netOf(loadLedger().grattage);
    ledgerEl.textContent = formatSigned(net);
    ledgerEl.className = signClass(net);
    messageEl.textContent = message;
    messageEl.dataset['tone'] = tone;

    const ticket = state.ticket;
    if (ticket === null || (showCatalog && state.phase !== 'SCRATCHING')) {
      surface?.destroy();
      surface = null;
      renderedSerial = null;
      stageEl.innerHTML = catalogHtml();
      return;
    }
    if (ticket.serial !== renderedSerial) buildTicket(ticket);
    const ticketEl = queryIn<HTMLElement>(stageEl, '[data-ticket]');
    ticketEl.classList.toggle('sc-xray', xrayEnabled());

    const labels = new Map(cellsOfTicket(ticket).map((cell) => [cell.id, cell]));
    for (const cellId of ticket.scratched) {
      if (revealedCells.has(cellId)) continue;
      revealedCells.add(cellId);
      surface?.reveal(cellId);
      const cell = labels.get(cellId);
      if (cell?.symbol === 'LETTER') markLetter(ticketEl, cell.label);
    }
    for (const zone of ticket.zones) {
      const button = ticketEl.querySelector<HTMLButtonElement>(`[data-action="SCRATCH_ZONE"][data-zone="${zone.id}"]`);
      const ids = ticketCellIds({ zones: [zone] });
      if (button !== null) button.hidden = ids.every((id) => revealedCells.has(id));
    }
    if (state.phase === 'REVEALED' && !evaluationShown) {
      showEvaluation(ticketEl, ticket.evaluation);
      evaluationShown = true;
    }
    queryIn<HTMLElement>(stageEl, '[data-actions]').innerHTML = actionsHtml(ticket);
  }

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('button[data-action]');
    if (button === null || button.disabled || busy) return;
    switch (button.dataset['action']) {
      case 'BUY': {
        const type = button.dataset['type'] ?? '';
        if (isTicketType(type)) buy(type);
        break;
      }
      case 'SCRATCH_ALL':
        apply({ type: 'SCRATCH_ALL', playerId: PLAYER });
        sync();
        break;
      case 'SCRATCH_ZONE':
        apply({ type: 'SCRATCH_ZONE', playerId: PLAYER, zoneId: button.dataset['zone'] ?? '' });
        sync();
        break;
      case 'CATALOG':
        showCatalog = true;
        [message, tone] = ['Choisissez votre prochain ticket.', 'info'];
        sync();
        break;
      case 'REBUY':
        if (claimDailyRefill('grattage')) {
          state = expectOk(controller.createSession(PLAYER, state.player.bankroll + DAILY_REFILL));
          showCatalog = true;
          [message, tone] = [REFILL_DONE_MESSAGE, 'win'];
        } else {
          [message, tone] = [REFILL_USED_MESSAGE, 'error'];
        }
        sync();
        break;
    }
  }

  function onResize(): void {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => surface?.paint(), 150);
  }

  function zoneTitle(ticket: Ticket, zoneId: string): string {
    return ticket.zones.find((zone) => zone.id === zoneId)?.title ?? zoneId;
  }

  setCheatTarget({
    games: ['grattage'],
    getBalance: () => state.player.bankroll,
    setBalance: (_game, amount) => {
      if (busy) return 'Patientez, la gomme brûle encore !';
      state = { ...state, player: { ...state.player, bankroll: chips(Number(amount)) } };
      sync();
      return null;
    },
    refresh: sync,
    foresee: () => {
      const current = state;
      if (current.phase !== 'SCRATCHING') return 'Achetez un ticket : la voyance lit ce qui est imprimé sous la pellicule.';
      const { evaluation } = current.ticket;
      if (evaluation.total === 0) return 'Ce ticket est perdant : inutile de s’user les ongles.';
      const details = evaluation.zones.filter((zone) => zone.won).map((zone) => `${zoneTitle(current.ticket, zone.zoneId)} : ${zone.detail}`);
      return `Ce ticket rapporte ${formatAmount(evaluation.total)} jetons (${details.join(' · ')}).`;
    },
    runCode: (code) => {
      if (!RACE_FIX_CODES.has(code)) return null;
      if (busy) return 'Le DRS est déjà ouvert !';
      const current = state;
      if (current.phase !== 'SCRATCHING' || current.ticket.type !== 'POLE_POSITION') {
        return 'DRS indisponible : ouvrez un ticket Pole Position Jackpot pas encore gratté.';
      }
      const zones = fixRace(current.ticket.zones);
      const rigged: ScratchingPhase = {
        ...current,
        ticket: { ...current.ticket, zones, evaluation: SCRATCH_GAMES.POLE_POSITION.evaluate(zones) },
      };
      state = rigged;
      renderedSerial = null;
      showCatalog = false;
      sync();

      busy = true;
      playTireScreech();
      const ticketEl = stageEl.querySelector<HTMLElement>('[data-ticket]');
      void (ticketEl === null ? Promise.resolve() : burnout(ticketEl)).then(() => {
        busy = false;
        if (disposed) return;
        apply({ type: 'SCRATCH_ALL', playerId: PLAYER });
        sync();
      });
      return `${code.toUpperCase()} activé : la gomme brûle, votre chrono est imbattable (${formatLapTime(UNBEATABLE_LAP_TIME)}).`;
    },
  });

  root.addEventListener('click', onClick);
  window.addEventListener('resize', onResize);
  sync();

  return () => {
    disposed = true;
    // Quitter avant la fin gratte le ticket d'office : le gain imprimé est crédité, rien n'est perdu.
    if (state.phase === 'SCRATCHING') {
      apply({ type: 'SCRATCH_ALL', playerId: PLAYER });
      saveBalance('grattage', state.player.bankroll);
    }
    window.clearTimeout(resizeTimer);
    surface?.destroy();
    setCheatTarget(null);
    root.removeEventListener('click', onClick);
    window.removeEventListener('resize', onResize);
  };
}
