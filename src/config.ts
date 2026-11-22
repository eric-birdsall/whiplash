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
export const LAND_BOOST = 4.5;
export const LAND_BOOST_TIME = 0.8;

// Perfect release: letting go just past the bottom of the swing (rope angle from straight down, forward
// positive) flings you harder. Each perfect release also counts as a chain link.
export const PERFECT_MIN = 0;
export const PERFECT_MAX = (28 * Math.PI) / 180;
export const PERFECT_FLING_X = 3;
export const PERFECT_FLING_Y = 4.5;

// Swing chains: every catch and every perfect release since last touching the ground is a link.
// Landing with 2+ links grows the landing burst and adds bonus distance.
export const CHAIN_BOOST_PER_LINK = 0.3; // landing burst × (1 + this × (links − 1)), capped below
export const CHAIN_BOOST_MAX = 2;
export const CHAIN_BONUS_PER_LINK = 5; // bonus metres per link beyond the first
