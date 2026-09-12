/** Crissement de pneus, gomme qui patine et V12 qui hurle, synthétisés en Web Audio (aucun fichier son). */
export function playTireScreech(): void {
  if (typeof window.AudioContext !== 'function') return;
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    return;
  }
  const now = context.currentTime;
  const duration = 1.6;

  const master = context.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.5, now + 0.06);
  master.gain.setValueAtTime(0.5, now + duration - 0.5);
  master.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  master.connect(context.destination);

  // Friction de la gomme : bruit blanc filtré qui glisse vers le grave.
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  const friction = context.createBiquadFilter();
  friction.type = 'bandpass';
  friction.Q.value = 9;
  friction.frequency.setValueAtTime(2_800, now);
  friction.frequency.exponentialRampToValueAtTime(900, now + duration);
  const frictionGain = context.createGain();
  frictionGain.gain.value = 0.9;
  noise.connect(friction).connect(frictionGain).connect(master);

  // Sifflement du pneu qui patine, avec un vibrato rapide.
  const squeal = context.createOscillator();
  squeal.type = 'sawtooth';
  squeal.frequency.setValueAtTime(1_900, now);
  squeal.frequency.exponentialRampToValueAtTime(700, now + duration);
  const vibrato = context.createOscillator();
  vibrato.frequency.value = 32;
  const vibratoDepth = context.createGain();
  vibratoDepth.gain.value = 70;
  vibrato.connect(vibratoDepth).connect(squeal.frequency);
  const squealFilter = context.createBiquadFilter();
  squealFilter.type = 'bandpass';
  squealFilter.frequency.value = 1_600;
  squealFilter.Q.value = 4;
  const squealGain = context.createGain();
  squealGain.gain.value = 0.12;
  squeal.connect(squealFilter).connect(squealGain).connect(master);

  // Moteur qui monte dans les tours.
  const engine = context.createOscillator();
  engine.type = 'sawtooth';
  engine.frequency.setValueAtTime(70, now);
  engine.frequency.exponentialRampToValueAtTime(260, now + duration * 0.8);
  const engineFilter = context.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 900;
  const engineGain = context.createGain();
  engineGain.gain.value = 0.25;
  engine.connect(engineFilter).connect(engineGain).connect(master);

  for (const source of [noise, squeal, vibrato, engine]) {
    source.start(now);
    source.stop(now + duration);
  }
  window.setTimeout(() => void context.close(), (duration + 0.3) * 1_000);
}

/**
 * Traces de gomme brûlée et fumée par-dessus le ticket pendant que la pellicule se consume.
 * La promesse est résolue quand la pellicule a disparu ; l'effet s'estompe ensuite tout seul.
 */
export function burnout(surface: HTMLElement): Promise<void> {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const overlay = document.createElement('div');
  overlay.className = 'sc-burnout';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <svg viewBox="0 0 400 240" preserveAspectRatio="none">
      <path class="sc-skid" pathLength="600" d="M -20 172 C 80 150, 140 58, 230 88 S 360 192, 430 68" />
      <path class="sc-skid" pathLength="600" d="M -20 200 C 84 178, 146 86, 236 116 S 366 220, 430 96" />
    </svg>
    ${Array.from({ length: 9 }, (_, i) => `<span class="sc-smoke" style="--i:${i}"></span>`).join('')}
    <span class="sc-drs">DRS</span>`;
  surface.append(overlay);
  surface.classList.add('sc-burning');

  return new Promise((resolve) => {
    window.setTimeout(resolve, reduced ? 150 : 1_100);
    window.setTimeout(
      () => {
        overlay.remove();
        surface.classList.remove('sc-burning');
      },
      reduced ? 400 : 2_700,
    );
  });
}
