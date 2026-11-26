// Keyboard, mouse, touch and game controllers, folded into one small InputState the game reads.
// Touch: left half of the screen jumps, right half grapples. Desktop: W jumps; E or a click grapples.
// Controller (standard / Xbox layout): A or LB jumps; RT, RB, X or B grapples; Menu pauses; View restarts.

export interface InputState {
  hookDown: boolean; // held
  hookPressed: boolean; // went down this frame
  jumpPressed: boolean; // went down this frame
  restart: boolean;
  pause: boolean;
}

const HOOK_KEYS = ['KeyE'];
const JUMP_KEYS = ['KeyW'];

// Gamepad API "standard" button indices (an Xbox controller maps to these in every major browser).
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const PAD_JUMP = [PAD.A, PAD.LB];
const PAD_HOOK = [PAD.RT, PAD.RB, PAD.X, PAD.B];
const STICK = 0.5; // left stick past this counts as a d-pad press (menus only)
/** Virtual buttons past the real ones, for the left stick's four directions. */
const STICK_UP = 100, STICK_DOWN = 101, STICK_LEFT = 102, STICK_RIGHT = 103;

/** Controller presses for menu screens (went down this frame). */
export interface PadMenu { up: boolean; down: boolean; left: boolean; right: boolean; confirm: boolean; back: boolean }

export class Input {
  state: InputState = { hookDown: false, hookPressed: false, jumpPressed: false, restart: false, pause: false };
  touchMode = matchMedia('(pointer: coarse)').matches;
  onFirstGesture: (() => void) | null = null;
  /** The last input came from a controller (switches the on-screen controls text and hides touch zones). */
  padMode = false;
  /** A controller button went down this frame. */
  padActivity = false;
  padMenu: PadMenu = { up: false, down: false, left: false, right: false, confirm: false, back: false };
  private padHeld = new Set<number>();
  private padHookDown = false;
  private keys = new Set<string>();
  private hookPointer: number | null = null;
  private jumpPointers = new Set<number>();

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.padMode = false;
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
    this.padMode = false;
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
    this.pollPads();
    this.state.hookDown = this.hookPointer !== null || this.padHookDown || HOOK_KEYS.some((k) => this.keys.has(k));
  }

  /** Read every connected controller (they all count as one) and turn new presses into edges. */
  private pollPads() {
    const pads = navigator.getGamepads?.() ?? [];
    const held = new Set<number>();
    for (const g of pads) {
      if (!g || !g.connected) continue;
      g.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.4) held.add(i); });
      const [x = 0, y = 0] = g.axes;
      if (y < -STICK) held.add(STICK_UP);
      if (y > STICK) held.add(STICK_DOWN);
      if (x < -STICK) held.add(STICK_LEFT);
      if (x > STICK) held.add(STICK_RIGHT);
    }
    const went = (...ids: number[]) => ids.some((i) => held.has(i) && !this.padHeld.has(i));
    this.padActivity = [...held].some((i) => !this.padHeld.has(i));
    if (this.padActivity) this.padMode = true;
    if (went(...PAD_JUMP)) this.state.jumpPressed = true;
    if (went(...PAD_HOOK) && this.hookPointer === null) this.state.hookPressed = true;
    if (went(PAD.MENU)) this.state.pause = true;
    if (went(PAD.VIEW)) this.state.restart = true;
    this.padMenu = {
      up: went(PAD.UP, STICK_UP), down: went(PAD.DOWN, STICK_DOWN),
      left: went(PAD.LEFT, STICK_LEFT), right: went(PAD.RIGHT, STICK_RIGHT),
      confirm: went(PAD.A), back: went(PAD.B),
    };
    this.padHookDown = PAD_HOOK.some((i) => held.has(i));
    this.padHeld = held;
  }

  /** A short controller rumble, where the browser supports it. */
  rumble(strong: number, weak: number, ms: number) {
    if (!this.padMode) return;
    for (const g of navigator.getGamepads?.() ?? []) {
      g?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch(() => {});
    }
  }

  /** Which touch zones are held (for drawing). */
  heldZones(): { jump: boolean; hook: boolean } {
    return { jump: this.jumpPointers.size > 0, hook: this.hookPointer !== null };
  }

  /**
   * Call at the end of each rendered frame. Jump/grapple presses are kept until a physics step has
   * used them (consumed = true): on high-refresh screens many frames run no physics step, and clearing
   * them anyway would drop presses.
   */
  clearEdges(consumed = true) {
    if (consumed) {
      this.state.hookPressed = false;
      this.state.jumpPressed = false;
    }
    this.state.restart = false;
    this.state.pause = false;
    for (const k of Object.keys(this.padMenu) as (keyof PadMenu)[]) this.padMenu[k] = false;
  }

  /** Forget everything held (buttons still physically down stay down, so they don't press again). */
  releaseAll() {
    this.keys.clear();
    this.padHookDown = false;
    this.hookPointer = null;
    this.jumpPointers.clear();
    this.state.hookDown = false;
    this.clearEdges();
  }
}
