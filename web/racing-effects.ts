import { escapeHtml } from './ui.js';

const ALMANAC_VISIBLE_MS = 5_000;

/** Carnet de sport qui apparaît brièvement par-dessus la piste (code ALMANACH). */
export function showAlmanac(host: HTMLElement, title: string, lines: readonly string[]): void {
  host.querySelector('.rc-almanac')?.remove();
  const note = document.createElement('aside');
  note.className = 'rc-almanac';
  note.setAttribute('role', 'note');
  note.innerHTML = `
    <h3>Almanach des sports · 1950-2050</h3>
    <p>${escapeHtml(title)}</p>
    <ol>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ol>
    <small>… à ne montrer à personne.</small>`;
  host.append(note);

  const leave = (): void => {
    note.classList.add('is-leaving');
    window.setTimeout(() => note.remove(), 500);
  };
  const timer = window.setTimeout(leave, ALMANAC_VISIBLE_MS);
  note.addEventListener(
    'click',
    () => {
      window.clearTimeout(timer);
      leave();
    },
    { once: true },
  );
}

/** Voix basse et lente : l'almanach chuchote l'arrivée (synthèse vocale du navigateur, si disponible). */
export function whisper(text: string): void {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance !== 'function') return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'fr-FR';
  utterance.volume = 0.35;
  utterance.rate = 0.85;
  utterance.pitch = 0.6;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export function silence(): void {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
