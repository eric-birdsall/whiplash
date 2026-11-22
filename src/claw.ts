// Arcade-crane style claw for the hook head.
// Local space: +x points along the throw; the prong tips sit at x≈0 (the grab point).

const CHROME = '#d5dbe4';
const CHROME_HI = '#f4f7fb';
const CHROME_DARK = '#5b6472';
const COLLAR = '#ffc93c';

/** Distance from the grab point back to where the cable attaches. */
export const CLAW_BACK = 0.42;

type P = [number, number];
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// Prong keyframes (top prong; bottom is mirrored): pivot → knuckle → tip → curl
const PIVOT: P = [-0.17, -0.055];
const CLOSED: P[] = [[-0.07, -0.11], [-0.005, -0.04], [-0.025, -0.005]];
const OPEN: P[] = [[-0.09, -0.21], [0.03, -0.215], [0.045, -0.15]];

function prong(ctx: CanvasRenderingContext2D, open: number, flip: number, back: boolean) {
  const pts = [PIVOT, ...CLOSED.map((c, i) => lerp(c, OPEN[i], open))].map(([x, y]) => [x, y * flip] as P);
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  path();
  ctx.strokeStyle = CHROME_DARK;
  ctx.lineWidth = 0.07;
  ctx.stroke();
  path();
  ctx.strokeStyle = back ? '#9aa3b1' : CHROME;
  ctx.lineWidth = 0.04;
  ctx.stroke();
}

/**
 * @param open 0 = clamped shut, 1 = wide open
 * @param scale overall size multiplier
 */
export function drawClaw(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, open: number, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  // Middle prong, seen edge-on behind the others: just a short darker finger.
  ctx.save();
  ctx.scale(1, 0.35);
  prong(ctx, open * 0.6, 1, true);
  ctx.restore();

  prong(ctx, open, -1, false);
  prong(ctx, open, 1, false);

  // Cable stem
  ctx.strokeStyle = CHROME_DARK;
  ctx.lineWidth = 0.05;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(-CLAW_BACK, 0);
  ctx.lineTo(-0.3, 0);
  ctx.stroke();

  // Hub: a little chrome dome, flat face forward.
  ctx.fillStyle = CHROME_DARK;
  ctx.beginPath();
  ctx.moveTo(-0.33, -0.05);
  ctx.quadraticCurveTo(-0.33, -0.11, -0.25, -0.11);
  ctx.lineTo(-0.15, -0.09);
  ctx.lineTo(-0.15, 0.09);
  ctx.lineTo(-0.25, 0.11);
  ctx.quadraticCurveTo(-0.33, 0.11, -0.33, 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = CHROME;
  ctx.beginPath();
  ctx.moveTo(-0.315, -0.045);
  ctx.quadraticCurveTo(-0.315, -0.09, -0.25, -0.09);
  ctx.lineTo(-0.165, -0.075);
  ctx.lineTo(-0.165, 0.075);
  ctx.lineTo(-0.25, 0.09);
  ctx.quadraticCurveTo(-0.315, 0.09, -0.315, 0.045);
  ctx.closePath();
  ctx.fill();
  // Shine
  ctx.fillStyle = CHROME_HI;
  ctx.fillRect(-0.29, -0.065, 0.09, 0.025);
  // Gold collar where the prongs hinge
  ctx.fillStyle = COLLAR;
  ctx.fillRect(-0.19, -0.085, 0.035, 0.17);
  // Pivot bolts
  ctx.fillStyle = CHROME_DARK;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(PIVOT[0], PIVOT[1] * s, 0.022, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
