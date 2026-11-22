// Keyboard, mouse and touch, folded into one small InputState the game reads.
// Touch: left half of the screen jumps, right half grapples. Desktop: Space/W/↑ jump; click, Shift, K or J grapple.

export interface InputState {
  hookDown: boolean; // held
  hookPressed: boolean; // went down this frame
  jumpPressed: boolean; // went down this frame
  restart: boolean;
  pause: boolean;
}

const HOOK_KEYS = ['ShiftLeft', 'ShiftRight', 'KeyK', 'KeyJ'];
const JUMP_KEYS = ['Space', 'KeyW', 'ArrowUp'];

export class Input {
  state: InputState = { hookDown: false, hookPressed: false, jumpPressed: false, restart: false, pause: false };
  touchMode = matchMedia('(pointer: coarse)').matches;
  onFirstGesture: (() => void) | null = null;
  private keys = new Set<string>();
  private hookPointer: number | null = null;
  private jumpPointers = new Set<number>();

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyR') this.state.restart = true;
      if (e.code === 'Escape' || e.code === 'KeyP') this.state.pause = true;
      if (JUMP_KEYS.includes(e.code)) { this.state.jumpPressed = true; e.preventDefault(); }
      if (HOOK_KEYS.includes(e.code) && this.hookPointer === null) this.state.hookPressed = true;
      this.gesture();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.releaseAll());

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    addEventListener('pointerup', (e) => this.up(e));
    addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private gesture() {
    if (this.onFirstGesture) {
      this.onFirstGesture();
      this.onFirstGesture = null;
    }
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    this.gesture();
    if (e.pointerType === 'touch') this.touchMode = true;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Touch: the left half of the screen jumps. A mouse click anywhere grapples.
    if (e.pointerType !== 'mouse') {
      const x = e.clientX - this.canvas.getBoundingClientRect().left;
      if (x < this.canvas.clientWidth / 2) {
        this.jumpPointers.add(e.pointerId);
        this.state.jumpPressed = true;
        return;
      }
    }
    if (this.hookPointer !== null) return;
    this.hookPointer = e.pointerId;
    this.state.hookPressed = true;
  }

  private up(e: PointerEvent) {
    this.jumpPointers.delete(e.pointerId);
    if (e.pointerId === this.hookPointer) this.hookPointer = null;
  }

  /** Call once per rendered frame before stepping the game. */
  poll() {
    this.state.hookDown = this.hookPointer !== null || HOOK_KEYS.some((k) => this.keys.has(k));
  }

  /** Which touch zones are held (for drawing). */
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
    this.keys.clear();
    this.hookPointer = null;
    this.jumpPointers.clear();
    this.state.hookDown = false;
    this.clearEdges();
  }
}
