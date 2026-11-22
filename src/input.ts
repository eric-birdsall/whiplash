// Keyboard, mouse and touch, folded into one small InputState the game reads.

export interface InputState {
  moveX: number; // -1, 0, 1
  hookDown: boolean; // held
  hookPressed: boolean; // went down this frame (consumed by game)
  jumpPressed: boolean; // went down this frame (runner mode)
  aimX: number; // CSS pixels, canvas-relative
  aimY: number;
  restart: boolean;
  pause: boolean;
}

export interface TouchButton {
  x: number;
  y: number;
  r: number;
  dir: -1 | 1;
}

export class Input {
  state: InputState = {
    moveX: 0, hookDown: false, hookPressed: false, jumpPressed: false, aimX: 0, aimY: 0, restart: false, pause: false,
  };
  touchMode = matchMedia('(pointer: coarse)').matches;
  private keys = new Set<string>();
  private hookPointer: number | null = null;
  private buttonPointers = new Map<number, -1 | 1>();
  onFirstGesture: (() => void) | null = null;
  /** Runner mode: no move buttons; on touch the left half of the screen jumps, the right half hooks. */
  runner = false;
  private jumpPointers = new Set<number>();

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyR') this.state.restart = true;
      if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') { this.state.jumpPressed = true; e.preventDefault(); }
      if (e.code === 'Escape' || e.code === 'KeyP') this.state.pause = true;
      this.gesture();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.buttonPointers.clear();
      this.jumpPointers.clear();
      this.hookPointer = null;
      this.state.hookDown = false;
    });

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    addEventListener('pointerup', (e) => this.up(e));
    addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.setAim(e);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Touch buttons in CSS pixels, bottom-left. */
  buttons(): TouchButton[] {
    const h = this.canvas.clientHeight;
    const r = Math.max(34, Math.min(56, h * 0.09));
    const pad = r * 0.5;
    const y = h - pad - r;
    return [
      { x: pad + r, y, r, dir: -1 },
      { x: pad + r * 3.4, y, r, dir: 1 },
    ];
  }

  private gesture() {
    if (this.onFirstGesture) {
      this.onFirstGesture();
      this.onFirstGesture = null;
    }
  }

  private setAim(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.state.aimX = e.clientX - rect.left;
    this.state.aimY = e.clientY - rect.top;
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    this.gesture();
    if (e.pointerType === 'touch') this.touchMode = true;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (this.touchMode && e.pointerType !== 'mouse' && this.runner) {
      if (px < this.canvas.clientWidth / 2) {
        this.jumpPointers.add(e.pointerId);
        this.state.jumpPressed = true;
        return;
      }
    } else if (this.touchMode && e.pointerType !== 'mouse') {
      for (const b of this.buttons()) {
        // generous hit area: 1.35x radius
        if (Math.hypot(px - b.x, py - b.y) < b.r * 1.35) {
          this.buttonPointers.set(e.pointerId, b.dir);
          return;
        }
      }
    }
    if (this.hookPointer !== null) return;
    this.hookPointer = e.pointerId;
    this.setAim(e);
    this.state.hookDown = true;
    this.state.hookPressed = true;
  }

  private up(e: PointerEvent) {
    this.buttonPointers.delete(e.pointerId);
    this.jumpPointers.delete(e.pointerId);
    if (e.pointerId === this.hookPointer) {
      this.hookPointer = null;
      this.state.hookDown = false;
    }
  }

  /** Call once per rendered frame before stepping the game. */
  poll() {
    let x = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    for (const d of this.buttonPointers.values()) x += d;
    this.state.moveX = Math.max(-1, Math.min(1, x));
  }

  /** Which touch buttons are currently held (for drawing). */
  heldDirs(): Set<number> {
    return new Set(this.buttonPointers.values());
  }

  /** Which runner-mode touch zones are held: 'jump' and/or 'hook' (for drawing). */
  heldZones(): { jump: boolean; hook: boolean } {
    return { jump: this.jumpPointers.size > 0, hook: this.hookPointer !== null };
  }

  clearEdges() {
    this.state.hookPressed = false;
    this.state.jumpPressed = false;
    this.state.restart = false;
    this.state.pause = false;
  }

  releaseAll() {
    this.hookPointer = null;
    this.state.hookDown = false;
    this.buttonPointers.clear();
    this.jumpPointers.clear();
    this.clearEdges();
  }
}
