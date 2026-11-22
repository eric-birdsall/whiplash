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
export const HOOK_RETURN_SPEED = 70;
export const HOOK_COOLDOWN = 0.15;

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
