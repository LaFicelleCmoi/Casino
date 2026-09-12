import { PLINKO_BUCKETS, PLINKO_ROWS, formatMultiplier, type Direction } from '../src/plinko/index.js';

const ROW_MS = 115;
/** Les billes détraquées par GRAVITY sont lourdes : elles glissent plus vite, sans rebondir. */
const HEAVY_ROW_MS = 85;
const FLASH_MS = 380;

export interface BallLaunch {
  readonly path: readonly Direction[];
  readonly bucket: number;
  readonly heavy: boolean;
  onLand(): void;
}

interface Flight extends BallLaunch {
  readonly start: number;
  readonly trail: { x: number; y: number }[];
}

interface Geometry {
  readonly spacing: number;
  readonly top: number;
  readonly rowGap: number;
  readonly cx: number;
  readonly bucketY: number;
  readonly peg: number;
  readonly ball: number;
}

/** Couleur d'une case : jaune au centre, rouge magenta aux extrémités. */
function bucketColor(bucket: number): string {
  const distance = Math.abs(bucket - PLINKO_ROWS / 2) / (PLINKO_ROWS / 2);
  return `hsl(${(48 - 70 * distance + 360) % 360}, 95%, ${56 - distance * 8}%)`;
}

/**
 * Pyramide Plinko en canvas : une rangée de 3 clous en haut, 18 en bas, 17 cases. Chaque bille suit le trajet décidé
 * par le moteur ; autant de billes que voulu peuvent tomber en même temps.
 */
export class PlinkoBoard {
  readonly #canvas: HTMLCanvasElement;
  #multipliers: readonly number[];
  #flights: Flight[] = [];
  readonly #flashes = new Map<number, number>();
  #frame = 0;
  #width = 0;
  #height = 0;
  #ratio = 1;

  constructor(canvas: HTMLCanvasElement, multipliers: readonly number[]) {
    this.#canvas = canvas;
    this.#multipliers = multipliers;
    this.resize();
  }

  get inFlight(): number {
    return this.#flights.length;
  }

  setMultipliers(multipliers: readonly number[]): void {
    this.#multipliers = multipliers;
    this.#request();
  }

  launch(ball: BallLaunch): void {
    this.#flights.push({ ...ball, start: performance.now(), trail: [] });
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
    const spacing = Math.min(this.#width / (PLINKO_ROWS + 3), this.#height / (PLINKO_ROWS + 2.6));
    const rowGap = spacing * 0.95;
    const top = spacing * 1.2;
    return {
      spacing,
      top,
      rowGap,
      cx: this.#width / 2,
      bucketY: top + PLINKO_ROWS * rowGap,
      peg: Math.max(1.5, spacing * 0.11),
      ball: Math.max(3, spacing * 0.24),
    };
  }

  #position(flight: Flight, now: number, g: Geometry): { x: number; y: number; landed: boolean } {
    const segment = (now - flight.start) / (flight.heavy ? HEAVY_ROW_MS : ROW_MS);
    const bucketX = g.cx + (flight.bucket - PLINKO_ROWS / 2) * g.spacing;
    if (segment >= PLINKO_ROWS + 1) return { x: bucketX, y: g.bucketY + g.rowGap * 0.45, landed: true };

    const index = Math.floor(segment);
    const u = segment - index;
    const offset = (rows: number): number => flight.path.slice(0, rows).reduce((sum, direction) => sum + (direction === 'R' ? 0.5 : -0.5), 0);
    const restY = (row: number): number => g.top + row * g.rowGap - (g.peg + g.ball);

    let from: { x: number; y: number };
    let to: { x: number; y: number };
    let bounce: number;
    if (index === 0) {
      from = { x: g.cx, y: g.top - g.rowGap * 1.1 };
      to = { x: g.cx, y: restY(0) };
      bounce = 0;
    } else {
      const row = index - 1;
      from = { x: g.cx + offset(row) * g.spacing, y: restY(row) };
      to = { x: g.cx + offset(row + 1) * g.spacing, y: row + 1 < PLINKO_ROWS ? restY(row + 1) : g.bucketY + g.rowGap * 0.45 };
      bounce = flight.heavy ? 0.05 : 0.45;
    }
    return {
      x: from.x + (to.x - from.x) * u,
      y: from.y + (to.y - from.y) * u - bounce * g.spacing * Math.sin(Math.PI * u),
      landed: false,
    };
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

    context.fillStyle = '#ffe6fb';
    context.shadowColor = 'rgba(255, 60, 200, 0.9)';
    context.shadowBlur = 6;
    for (let row = 0; row < PLINKO_ROWS; row += 1) {
      for (let peg = 0; peg < row + 3; peg += 1) {
        context.beginPath();
        context.arc(g.cx + (peg - (row + 2) / 2) * g.spacing, g.top + row * g.rowGap, g.peg, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.shadowBlur = 0;

    const bucketWidth = g.spacing * 0.9;
    const bucketHeight = g.rowGap * 0.9;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `800 ${Math.max(7, g.spacing * 0.27)}px Inter, system-ui, sans-serif`;
    for (let bucket = 0; bucket < PLINKO_BUCKETS; bucket += 1) {
      const flash = this.#flashes.get(bucket);
      const hit = flash === undefined ? 0 : Math.max(0, 1 - (now - flash) / FLASH_MS);
      const x = g.cx + (bucket - PLINKO_ROWS / 2) * g.spacing - bucketWidth / 2;
      const y = g.bucketY + hit * 5;
      context.fillStyle = bucketColor(bucket);
      if (hit > 0) {
        context.shadowColor = bucketColor(bucket);
        context.shadowBlur = 22 * hit;
      }
      context.beginPath();
      context.roundRect(x, y, bucketWidth, bucketHeight, 4);
      context.fill();
      context.shadowBlur = 0;
      context.fillStyle = '#2a0620';
      context.fillText(formatMultiplier(this.#multipliers[bucket] ?? 0), x + bucketWidth / 2, y + bucketHeight / 2);
    }

    const stillFlying: Flight[] = [];
    for (const flight of this.#flights) {
      const position = this.#position(flight, now, g);
      flight.trail.push({ x: position.x, y: position.y });
      if (flight.trail.length > (flight.heavy ? 14 : 5)) flight.trail.shift();
      const radius = flight.heavy ? g.ball * 1.5 : g.ball;

      flight.trail.forEach((point, index) => {
        context.globalAlpha = ((index + 1) / flight.trail.length) * (flight.heavy ? 0.45 : 0.18);
        context.fillStyle = flight.heavy ? '#ffb300' : '#ff5fcf';
        context.beginPath();
        context.arc(point.x, point.y, radius * (0.4 + (0.6 * (index + 1)) / flight.trail.length), 0, Math.PI * 2);
        context.fill();
      });
      context.globalAlpha = 1;

      if (flight.heavy) {
        const glow = context.createRadialGradient(position.x - radius * 0.3, position.y - radius * 0.3, radius * 0.1, position.x, position.y, radius);
        glow.addColorStop(0, '#ffffff');
        glow.addColorStop(0.45, '#ffd166');
        glow.addColorStop(1, '#ff7b00');
        context.fillStyle = glow;
        context.shadowColor = '#ffb300';
        context.shadowBlur = 26;
      } else {
        context.fillStyle = '#ff5fcf';
        context.shadowColor = '#ff2fb3';
        context.shadowBlur = 10;
      }
      context.beginPath();
      context.arc(position.x, position.y, radius, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;

      if (position.landed) {
        this.#flashes.set(flight.bucket, now);
        flight.onLand();
      } else {
        stillFlying.push(flight);
      }
    }
    this.#flights = stillFlying;
    for (const [bucket, time] of this.#flashes) {
      if (now - time > FLASH_MS) this.#flashes.delete(bucket);
    }
    if (this.#flights.length > 0 || this.#flashes.size > 0) this.#request();
  };
}
