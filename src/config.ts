// All tuning knobs in one place. Units: tiles and seconds.

// Visible world in tiles (16:9). Bigger = zoomed out.
export const VIEW_W = 32;
export const VIEW_H = 18;
export const STEP = 1 / 60;

export const PLAYER_W = 0.75;
export const PLAYER_H = 1.25;

export const GRAVITY = 32;
export const MAX_FALL = 24;

// Running: always to the right. Speed ramps from RUN_SPEED to RUN_SPEED + RUN_SPEED_GAIN (src/endless.ts).
export const RUN_SPEED = 7;
export const RUN_SPEED_GAIN = 3.5;
export const GROUND_ACCEL = 60;
export const AIR_ACCEL = 14;

// Jumping
export const JUMP_VEL = 12.5; // ≈2.4 tiles high, ≈5.5 tiles long at base speed
export const DOUBLE_JUMP_VEL = 12; // one extra jump in the air, refreshed on landing or grappling
export const COYOTE = 0.1; // can still jump this long after leaving a ledge
export const JUMP_BUFFER = 0.12; // a tap this early before landing still jumps

// Grapple: fires at a fixed 45° up-forward, bending toward a ring or wood underside within the assist cone.
export const HOOK_SPEED = 48;
export const HOOK_RANGE = 11;
export const AUTO_AIM_ANGLE = Math.PI / 4;
export const AIM_ASSIST = (14 * Math.PI) / 180; // max bend either side of 45°
export const HOOK_RETURN_SPEED = 160; // a missed shot snaps back fast
export const HOOK_COOLDOWN = 0.06;
// A tap is remembered this long (while still held) and fires as soon as the hook is ready.
// While airborne it also waits (within this time) for something to lock onto instead of firing at air.
export const HOOK_BUFFER = 0.25;

// Rope
export const REEL_SPEED = 5.5;
export const ROPE_MIN = 1.1;
export const SWING_GRAVITY = 20; // gravity while hanging: lower = slower, floatier pendulum
export const SWING_PUMP = 10; // forward accel while hanging
export const ROPE_MAX_SPEED = 17;
export const RING_RADIUS = 0.32;

export const PIN_KILL = 0.45; // pinned against a wall this long ends the run (no softlocks)

// Landing after a swing gives a short speed burst: the run speed target rises by this much and fades out.
export const LAND_BOOST = 3;
export const LAND_BOOST_TIME = 0.8;
