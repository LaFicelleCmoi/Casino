import { FEVER_MULTIPLIER, POCKETS, formatPocketMultiplier, type Metal } from '../src/pachinko/index.js';

const PIN_ROWS = 11;
const SEGMENT_MS = 95;
/** Les billes dorées de FEVERTIME filent tout droit, attirées par la poche Platine. */
const GOLDEN_SEGMENT_MS = 60;
const FLASH_MS = 420;
const SLOT_SPIN_MS = 950;
const JACKPOT_FLASH_MS = 1_800;

const METAL_COLORS: Readonly<Record<Metal, string>> = {
  BRONZE: '#cd7f32',
  ARGENT: '#c9d1d9',
  OR: '#ffd34d',
  PLATINE: '#dff6ff',
  BONUS: '#ff2fb3',
};

export interface PachinkoLaunch {
  readonly pocket: number;
  readonly golden: boolean;
  readonly fever: boolean;
  onLand(): void;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Flight extends PachinkoLaunch {
  readonly path: readonly Point[];
  readonly start: number;
  readonly trail: Point[];
}

interface Geometry {
  readonly width: number;
  readonly height: number;
  readonly spacing: number;
  readonly pin: number;
  readonly ball: number;
  readonly rows: readonly number[];
  readonly pocketTop: number;
  readonly pocketHeight: number;
  readonly pocketWidth: number;
  readonly lcd: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

/**
 * Plateau de Pachinko en canvas : écran à chiffres au centre, forêt de clous, poches de métal en bas.
 * La poche de chaque bille est décidée par le moteur ; la trajectoire en cascade n'est qu'une mise en scène qui y mène.
 */
export class PachinkoBoard {
  readonly #canvas: HTMLCanvasElement;
  #flights: Flight[] = [];
  readonly #flashes = new Map<number, number>();
  #frame = 0;
  #width = 0;
  #height = 0;
  #ratio = 1;
  #digits: readonly number[] = [7, 7, 7];
  #spinUntil = 0;
  #jackpotUntil = 0;
  #feverBalls: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.resize();
  }

  get inFlight(): number {
    return this.#flights.length;
  }

  /** Billes gratuites restantes du Fever Mode, ou null hors Fever. */
  setFever(balls: number | null): void {
    this.#feverBalls = balls;
    this.#request();
  }

  /** Fait tourner la machine à sous puis affiche `digits` ; la promesse est résolue quand les rouleaux s'arrêtent. */
  spinSlot(digits: readonly number[], jackpot: boolean): Promise<void> {
    const now = performance.now();
    this.#digits = digits;
    this.#spinUntil = now + SLOT_SPIN_MS;
    this.#jackpotUntil = jackpot ? now + SLOT_SPIN_MS + JACKPOT_FLASH_MS : 0;
    this.#request();
    return new Promise((resolve) => window.setTimeout(resolve, SLOT_SPIN_MS));
  }

  launch(ball: PachinkoLaunch): void {
    this.#flights.push({ ...ball, path: this.#pathFor(ball, this.#geometry()), start: performance.now(), trail: [] });
    this.#request();
  }

  resize(): void {
    const rect = this.#canvas.getBoundingClientRect();
    this.#ratio = window.devicePixelRatio || 1;
    this.#width = rect.width;
    this.#height = rect.height;
    this.#canvas.width = Math.max(1, Math.round(rect.width * this.#ratio));
    this.#canvas.height = Math.max(1, Math.round(rect.height * this.#ratio));
    this.#request();
  }

  destroy(): void {
    if (this.#frame !== 0) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#flights = [];
  }

  #geometry(): Geometry {
    const width = this.#width;
    const height = this.#height;
    const pocketHeight = height * 0.1;
    const pocketTop = height - pocketHeight - 4;
    const lcd = { x: width * 0.3, y: height * 0.05, w: width * 0.4, h: height * 0.12 };
    const top = lcd.y + lcd.h + height * 0.07;
    const bottom = pocketTop - height * 0.05;
    const spacing = width / 10;
    return {
      width,
      height,
      spacing,
      pin: Math.max(1.6, spacing * 0.07),
      ball: Math.max(3, spacing * 0.17),
      rows: Array.from({ length: PIN_ROWS }, (_, row) => top + ((bottom - top) * row) / (PIN_ROWS - 1)),
      pocketTop,
      pocketHeight,
      pocketWidth: width / POCKETS.length,
      lcd,
    };
  }

  #pathFor(ball: PachinkoLaunch, g: Geometry): Point[] {
    const target = (ball.pocket + 0.5) * g.pocketWidth;
    const fromLeft = Math.random() < 0.5;
    // Une bille ordinaire contourne l'écran par un côté, puis ricoche vers sa poche ; une bille dorée plonge droit dessus.
    let x = ball.golden ? target : (fromLeft ? g.width * 0.15 : g.width * 0.85) + (Math.random() - 0.5) * g.spacing;
    const points: Point[] = [
      { x: ball.golden ? g.width / 2 : fromLeft ? g.width * 0.05 : g.width * 0.95, y: -g.ball },
      { x, y: g.lcd.y + g.lcd.h * 0.6 },
    ];
    g.rows.forEach((y, row) => {
      const remaining = g.rows.length - row;
      const jitter = ball.golden ? 0 : (Math.random() - 0.5) * g.spacing * Math.min(1, (remaining - 1) / 3);
      x = Math.min(g.width - g.spacing * 0.5, Math.max(g.spacing * 0.5, x + (target - x) / remaining + jitter));
      points.push({ x, y: y - g.pin - g.ball });
    });
    points.push({ x: target, y: g.pocketTop + g.pocketHeight * 0.45 });
    return points;
  }

  #position(flight: Flight, now: number): { point: Point; landed: boolean } {
    const segments = flight.path.length - 1;
    const progress = (now - flight.start) / (flight.golden ? GOLDEN_SEGMENT_MS : SEGMENT_MS);
    const last = flight.path[segments] ?? { x: 0, y: 0 };
    if (progress >= segments) return { point: last, landed: true };
    const index = Math.floor(progress);
    const u = progress - index;
    const from = flight.path[index] ?? last;
    const to = flight.path[index + 1] ?? last;
    const bounce = index >= 2 && !flight.golden ? Math.sin(Math.PI * u) * Math.abs(to.y - from.y) * 0.35 : 0;
    return { point: { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u - bounce }, landed: false };
  }

  #request(): void {
    if (this.#frame === 0) this.#frame = requestAnimationFrame(this.#draw);
  }

  readonly #draw = (now: number): void => {
    this.#frame = 0;
    const context = this.#canvas.getContext('2d');
    if (context === null) return;
    const g = this.#geometry();
    context.setTransform(this.#ratio, 0, 0, this.#ratio, 0, 0);
    context.clearRect(0, 0, this.#width, this.#height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    // Écran à chiffres
    const spinning = now < this.#spinUntil;
    const jackpot = !spinning && now < this.#jackpotUntil;
    const { lcd } = g;
    context.fillStyle = '#0b0216';
    context.strokeStyle = jackpot ? '#ffd34d' : '#ff2fb3';
    context.lineWidth = 2;
    context.shadowColor = context.strokeStyle;
    context.shadowBlur = jackpot ? 26 : 14;
    context.beginPath();
    context.roundRect(lcd.x, lcd.y, lcd.w, lcd.h, 10);
    context.fill();
    context.stroke();
    const digits = spinning ? [0, 1, 2].map(() => Math.floor(Math.random() * 10)) : this.#digits;
    context.font = `900 ${lcd.h * 0.58}px Inter, system-ui, sans-serif`;
    context.fillStyle = jackpot ? (Math.floor(now / 120) % 2 === 0 ? '#ffd34d' : '#ffffff') : '#ffe6fb';
    digits.forEach((digit, index) => context.fillText(String(digit), lcd.x + (lcd.w * (index + 1)) / 4, lcd.y + lcd.h / 2));
    context.shadowBlur = 0;
    if (this.#feverBalls !== null) {
      context.font = `900 ${lcd.h * 0.24}px Inter, system-ui, sans-serif`;
      context.fillStyle = `hsl(${(now / 4) % 360}, 100%, 66%)`;
      context.fillText(`FEVER · ${this.#feverBalls}`, lcd.x + lcd.w / 2, lcd.y + lcd.h + lcd.h * 0.28);
    }

    // Clous en quinconce
    context.fillStyle = '#efe6ff';
    context.shadowColor = 'rgba(160, 90, 255, 0.9)';
    context.shadowBlur = 5;
    g.rows.forEach((y, row) => {
      for (let x = (row % 2 === 0 ? 0.5 : 1) * g.spacing; x < g.width - g.spacing * 0.4; x += g.spacing) {
        context.beginPath();
        context.arc(x, y, g.pin, 0, Math.PI * 2);
        context.fill();
      }
    });
    context.shadowBlur = 0;

    // Poches de métal
    const fever = this.#feverBalls !== null;
    POCKETS.forEach((pocket, index) => {
      const flash = this.#flashes.get(index);
      const hit = flash === undefined ? 0 : Math.max(0, 1 - (now - flash) / FLASH_MS);
      const x = index * g.pocketWidth + 2;
      const width = g.pocketWidth - 4;
      const color = METAL_COLORS[pocket.metal];
      const gradient = context.createLinearGradient(0, g.pocketTop, 0, g.pocketTop + g.pocketHeight);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, '#1a0630');
      context.fillStyle = gradient;
      if (hit > 0) {
        context.shadowColor = color;
        context.shadowBlur = 28 * hit;
      }
      context.beginPath();
      context.roundRect(x, g.pocketTop - hit * 4, width, g.pocketHeight, 6);
      context.fill();
      context.shadowBlur = 0;
      context.fillStyle = '#1a0630';
      context.font = `800 ${Math.max(8, g.pocketHeight * 0.19)}px Inter, system-ui, sans-serif`;
      context.fillText(pocket.label, x + width / 2, g.pocketTop + g.pocketHeight * 0.28);
      context.fillStyle = '#ffffff';
      context.font = `900 ${Math.max(9, g.pocketHeight * 0.27)}px Inter, system-ui, sans-serif`;
      const multiplier = pocket.multiplier * (fever ? FEVER_MULTIPLIER : 1);
      context.fillText(`×${formatPocketMultiplier(multiplier)}`, x + width / 2, g.pocketTop + g.pocketHeight * 0.68);
    });

    // Billes
    const stillFalling: Flight[] = [];
    for (const flight of this.#flights) {
      const { point, landed } = this.#position(flight, now);
      flight.trail.push(point);
      if (flight.trail.length > (flight.golden ? 12 : 4)) flight.trail.shift();
      const radius = flight.golden ? g.ball * 1.35 : g.ball;
      const tint = flight.golden ? '#ffc53d' : flight.fever ? '#ff5fcf' : '#dfe6f5';
      flight.trail.forEach((trace, index) => {
        context.globalAlpha = ((index + 1) / flight.trail.length) * (flight.golden ? 0.5 : 0.2);
        context.fillStyle = tint;
        context.beginPath();
        context.arc(trace.x, trace.y, radius * (0.4 + (0.6 * (index + 1)) / flight.trail.length), 0, Math.PI * 2);
        context.fill();
      });
      context.globalAlpha = 1;
      const shine = context.createRadialGradient(point.x - radius * 0.35, point.y - radius * 0.35, radius * 0.1, point.x, point.y, radius);
      shine.addColorStop(0, '#ffffff');
      shine.addColorStop(0.5, flight.golden ? '#ffd34d' : flight.fever ? '#ff9be3' : '#c9d1d9');
      shine.addColorStop(1, flight.golden ? '#ff8a00' : flight.fever ? '#c2168a' : '#6b7486');
      context.fillStyle = shine;
      context.shadowColor = tint;
      context.shadowBlur = flight.golden ? 22 : flight.fever ? 12 : 4;
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;

      if (landed) {
        this.#flashes.set(flight.pocket, now);
        flight.onLand();
      } else {
        stillFalling.push(flight);
      }
    }
    this.#flights = stillFalling;
    for (const [pocket, time] of this.#flashes) {
      if (now - time > FLASH_MS) this.#flashes.delete(pocket);
    }
    if (this.#flights.length > 0 || this.#flashes.size > 0 || spinning || now < this.#jackpotUntil || this.#feverBalls !== null) this.#request();
  };
}
