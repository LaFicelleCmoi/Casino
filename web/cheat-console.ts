import type { GameKey } from './money-ledger.js';
import { formatChips, queryIn } from './ui.js';

/** Écran actif (lobby ou table) sur lequel les codes de triche s'appliquent. */
export interface CheatTarget {
  /** Jeux dont le solde peut être modifié depuis cet écran. */
  readonly games: readonly GameKey[];
  getBalance(game: GameKey): number | bigint;
  /** Retourne un message d'erreur si la modification est refusée pour l'instant. */
  setBalance(game: GameKey, amount: bigint): string | null;
  /** Redessine l'écran, par exemple après avoir activé les rayons X. */
  refresh(): void;
  /** Décrit les prochaines cartes ; absent hors d'une table. */
  foresee?(): string;
  /** Codes propres à un écran (ex : DRSZONE) : message si le code est reconnu, null sinon. */
  runCode?(code: string): string | null;
  /** Présent quand l'écran refuse toute triche (table partagée rejointe en invité) : message affiché à chaque code. */
  readonly locked?: string;
}

type Tone = 'cmd' | 'ok' | 'error' | 'info';

/** Plafond des jeux à entiers sûrs ; la Roulette sans limite n'en a aucun. */
const MAX_AMOUNT = 1_000_000_000_000n;
const UNLIMITED_GAMES: ReadonlySet<GameKey> = new Set(['roulette']);
const ALWAYS_ALLOWED = new Set(['aide', 'help', 'effacer', 'clear']);
const GAME_ALIASES: Readonly<Record<string, GameKey>> = {
  bj: 'blackjack',
  blackjack: 'blackjack',
  holdem: 'holdem',
  poker: 'holdem',
  roulette: 'roulette',
  grattage: 'grattage',
  tickets: 'grattage',
  courses: 'courses',
  course: 'courses',
  plinko: 'plinko',
  mines: 'mines',
  hilo: 'hilo',
  'hi-lo': 'hilo',
  pachinko: 'pachinko',
};
const GAME_LABELS: Readonly<Record<GameKey, string>> = {
  blackjack: 'Blackjack',
  holdem: "Hold'em",
  roulette: 'Roulette',
  grattage: 'Tickets à gratter',
  courses: 'Courses hippiques',
  plinko: 'Plinko',
  mines: 'Mines',
  hilo: 'Hi-Lo',
  pachinko: 'Pachinko',
};

const HELP = [
  'aide                         liste des codes',
  'argent <montant> [jeu]       fixe le solde (bj, holdem, roulette, grattage, courses, plinko, mines, hilo, pachinko ; roulette sans limite)',
  'ajouter <montant> [jeu]      ajoute des jetons (négatif pour en retirer)',
  'motherlode [jeu]             +50 000 jetons',
  'rosebud [jeu]                +1 000 jetons',
  'rayons-x                     montre les cartes cachées et rend la pellicule des tickets translucide',
  'voyance                      annonce les prochaines cartes, le prochain numéro ou le gain d’un ticket',
  'drszone / v12turbo           Pole Position Jackpot : gomme brûlée et chrono imbattable',
  'almanach                     Courses : l’arrivée du tiercé chuchotée, cheval de tête en feu',
  'gravity / newton             Plinko : billes lourdes attirées vers les ×1000 (retaper pour annuler)',
  'minesweeper                  Mines : les bombes luisent en rouge sous les cases (retaper pour annuler)',
  'nostradamus                  Hi-Lo : la carte suivante s’affiche en coin d’écran (retaper pour annuler)',
  'fevertime                    Pachinko : Fever Mode immédiat, 50 billes dorées guidées vers la Platine',
  'effacer                      vide la console',
  'Touche ² (ou `) pour ouvrir ou fermer, Échap pour fermer.',
];

let target: CheatTarget | null = null;
let xray = false;

export function setCheatTarget(next: CheatTarget | null): void {
  target = next;
}

export const xrayEnabled = (): boolean => xray;

function parseAmount(raw: string | undefined): bigint | null {
  if (raw === undefined) return null;
  const digits = raw.replace(/_/g, '');
  return /^-?\d+$/.test(digits) ? BigInt(digits) : null;
}

export function mountCheatConsole(): void {
  const toggle = document.createElement('button');
  toggle.className = 'cheat-toggle';
  toggle.type = 'button';
  toggle.textContent = '>_';
  toggle.setAttribute('aria-label', 'Console de triche');
  toggle.setAttribute('aria-expanded', 'false');

  const panel = document.createElement('section');
  panel.className = 'cheat-console';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Console de triche');
  panel.innerHTML = `
    <div class="cheat-head"><span>Console</span><button type="button" class="cheat-close" aria-label="Fermer">×</button></div>
    <ol class="cheat-output" data-output aria-live="polite"></ol>
    <form class="cheat-form">
      <span aria-hidden="true">›</span>
      <input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Code de triche" placeholder="aide">
    </form>`;
  document.body.append(toggle, panel);

  const output = queryIn<HTMLOListElement>(panel, '[data-output]');
  const form = queryIn<HTMLFormElement>(panel, 'form');
  const input = queryIn<HTMLInputElement>(panel, 'input');
  const history: string[] = [];
  let historyCursor = 0;

  function print(text: string, tone: Tone): void {
    const line = document.createElement('li');
    line.textContent = text;
    line.dataset['tone'] = tone;
    output.append(line);
    output.scrollTop = output.scrollHeight;
  }

  function setOpen(open: boolean): void {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
    else input.blur();
  }

  function changeBalance(gameArg: string | undefined, compute: (current: bigint) => bigint): void {
    const screen = target;
    if (screen === null) return print('Aucun écran actif.', 'error');
    let games: readonly GameKey[] = screen.games;
    if (gameArg !== undefined) {
      const game = GAME_ALIASES[gameArg.toLowerCase()];
      if (game === undefined) return print(`Jeu inconnu : ${gameArg} (bj, holdem, roulette, grattage, courses, plinko, mines, hilo ou pachinko).`, 'error');
      if (!games.includes(game)) return print(`Le solde ${GAME_LABELS[game]} se modifie depuis le lobby ou sa table.`, 'error');
      games = [game];
    }
    for (const game of games) {
      let amount = compute(BigInt(screen.getBalance(game)));
      if (amount < 0n) amount = 0n;
      if (!UNLIMITED_GAMES.has(game) && amount > MAX_AMOUNT) amount = MAX_AMOUNT;
      const error = screen.setBalance(game, amount);
      if (error === null) print(`${GAME_LABELS[game]} : solde fixé à ${formatChips(amount)} jetons.`, 'ok');
      else print(error, 'error');
    }
  }

  function run(line: string): void {
    const [name = '', ...args] = line.trim().split(/\s+/);
    const code = name.toLowerCase();
    if (target?.locked !== undefined && !ALWAYS_ALLOWED.has(code)) return print(target.locked, 'error');
    switch (code) {
      case 'aide':
      case 'help':
        for (const help of HELP) print(help, 'info');
        break;
      case 'argent':
      case 'money': {
        const amount = parseAmount(args[0]);
        if (amount === null) return print('Usage : argent <montant> [jeu]', 'error');
        changeBalance(args[1], () => amount);
        break;
      }
      case 'ajouter':
      case 'add': {
        const amount = parseAmount(args[0]);
        if (amount === null) return print('Usage : ajouter <montant> [jeu]', 'error');
        changeBalance(args[1], (current) => current + amount);
        break;
      }
      case 'motherlode':
        changeBalance(args[0], (current) => current + 50_000n);
        break;
      case 'rosebud':
        changeBalance(args[0], (current) => current + 1_000n);
        break;
      case 'rayons-x':
      case 'xray':
        xray = !xray;
        target?.refresh();
        print(xray ? 'Rayons X activés : les cartes cachées sont visibles.' : 'Rayons X désactivés.', 'ok');
        break;
      case 'voyance':
      case 'peek':
        if (target?.foresee === undefined) print('La voyance ne fonctionne qu’à une table.', 'error');
        else print(target.foresee(), 'info');
        break;
      case 'effacer':
      case 'clear':
        output.replaceChildren();
        break;
      default: {
        const answer = target?.runCode?.(code) ?? null;
        if (answer === null) print(`Code inconnu : ${name}. Tapez « aide ».`, 'error');
        else print(answer, 'ok');
      }
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const line = input.value;
    input.value = '';
    if (line.trim() === '') return;
    history.push(line);
    historyCursor = history.length;
    print(`› ${line}`, 'cmd');
    run(line);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      historyCursor = Math.min(history.length, Math.max(0, historyCursor + (event.key === 'ArrowUp' ? -1 : 1)));
      input.value = history[historyCursor] ?? '';
    }
    // Les raccourcis des tables (H, S, Entrée…) ne doivent pas se déclencher pendant la saisie.
    if (event.code !== 'Backquote' && event.key !== 'Escape') event.stopPropagation();
  });

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Backquote') {
        event.preventDefault();
        setOpen(panel.hidden);
      } else if (event.key === 'Escape' && !panel.hidden) {
        setOpen(false);
      }
    },
    { capture: true },
  );
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  queryIn<HTMLButtonElement>(panel, '.cheat-close').addEventListener('click', () => setOpen(false));

  print('Console de triche. Tapez « aide » pour la liste des codes.', 'info');
}
