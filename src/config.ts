// All tuning knobs in one place. Units: tiles and seconds.

export const VIEW_W = 24;
export const VIEW_H = 13.5;
export const STEP = 1 / 60;

export const PLAYER_W = 0.75;
export const PLAYER_H = 1.25;

export const GRAVITY = 32;
export const MAX_FALL = 24;

export const RUN_SPEED = 7;
export const GROUND_ACCEL = 60;
export const GROUND_FRICTION = 50;
export const AIR_ACCEL = 14;
export const AIR_DRAG = 0.4; // per second, fraction of horizontal speed lost with no input

export const HOOK_SPEED = 48;
export const HOOK_RANGE = 9;
// Runner mode fires at a fixed 45° up-forward, bending toward anything grabbable within the assist cone.
export const RUNNER_HOOK_RANGE = 11;
export const AUTO_AIM_ANGLE = Math.PI / 4;
export const AIM_ASSIST = (14 * Math.PI) / 180; // max bend either side of 45°
export const HOOK_RETURN_SPEED = 160; // a missed shot snaps back fast
export const HOOK_COOLDOWN = 0.06;
// A tap is remembered this long (while still held) and fires as soon as the hook is ready.
// In Runner, an airborne tap also waits (within this time) for something to lock onto instead of firing at air.
export const HOOK_BUFFER = 0.25;

export const REEL_SPEED = 5.5;
export const ROPE_MIN = 1.1;
export const SWING_GRAVITY = 20; // gravity while hanging: lower = slower, floatier pendulum
export const SWING_PUMP = 10; // tangential accel while hanging
export const ROPE_MAX_SPEED = 17;

export const PULL_SPEED = 13;
export const PUSH_SPEED = 3;
export const CRATE_SIZE = 0.95;
export const KEY_SIZE = 0.6;
export const RING_RADIUS = 0.32;

export const RESPAWN_DELAY = 0.5;

// Runner mode: always running right; tap to jump.
export const JUMP_VEL = 10; // ≈1.5 tiles high, ≈4.4 tiles long at run speed
export const COYOTE = 0.1; // can still jump this long after leaving a ledge
export const JUMP_BUFFER = 0.12; // a tap this early before landing still jumps
export const PIN_KILL = 0.45; // Runner: pinned against a wall this long counts as a fail (no softlocks)
