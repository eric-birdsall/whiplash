"""Draw the Whiplash app icons (PWA + iOS home screen) with Pillow.

Usage (dev only):  python3 -m venv .venv && .venv/bin/pip install pillow && .venv/bin/python tools/make_icons.py
Writes public/icons/*.png. The art: a wood ceiling, a rope at 45°, and the arcade claw gripping it.
"""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

S = 1024  # draw big, downscale for smooth edges
OUT = Path(__file__).resolve().parent.parent / 'public' / 'icons'

BG_TOP = (20, 27, 45)
BG_BOT = (36, 48, 74)
WOOD = (138, 90, 52)
WOOD_TOP = (201, 138, 82)
WOOD_LINE = (110, 69, 39)
ROPE = (244, 233, 208)
CHROME = (213, 219, 228)
CHROME_HI = (244, 247, 251)
CHROME_DARK = (91, 100, 114)
COLLAR = (255, 201, 60)
CYAN = (125, 240, 255)


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def draw_icon(maskable: bool) -> Image.Image:
    img = Image.new('RGB', (S, S))
    d = ImageDraw.Draw(img)
    for y in range(S):
        t = y / (S - 1)
        d.line([(0, y), (S, y)], fill=tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)))

    # Maskable icons get cropped to a circle-ish safe zone: shrink the art toward the center.
    k = 0.78 if maskable else 1.0
    def P(x, y):  # icon-unit coords (0..1) → pixels
        return ((0.5 + (x - 0.5) * k) * S, (0.5 + (y - 0.5) * k) * S)

    rnd = random.Random(7)
    for _ in range(26):
        x, y = rnd.uniform(0.05, 0.95), rnd.uniform(0.32, 0.95)
        r = rnd.uniform(2, 5) * k
        cx, cy = P(x, y)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(200, 210, 235))

    # Wood ceiling with a bright underside lip (the grab surface)
    top, under = P(0, 0.06)[1] if not maskable else 0, P(0, 0.30)[1]
    d.rectangle([0, top, S, under], fill=WOOD)
    rows = 3
    for i in range(1, rows):
        y = top + (under - top) * i / rows
        d.line([(0, y), (S, y)], fill=WOOD_LINE, width=int(7 * k))
    for i in range(rows):
        y0 = top + (under - top) * i / rows
        y1 = top + (under - top) * (i + 1) / rows
        off = 0.5 if i % 2 else 0
        for j in range(-1, 6):
            x = (j + off) * S / 4.5
            d.line([(x, y0), (x, y1)], fill=WOOD_LINE, width=int(7 * k))
    lip = 0.035 * S * k
    d.rectangle([0, under - lip, S, under], fill=WOOD_TOP)

    # Rope at exactly 45°, from the gauntlet (lower left) up to the claw
    grab = P(0.68, 0.30)  # prong tips touch the ceiling underside here
    ang = -math.pi / 4  # throw direction: up and to the right
    ux, uy = math.cos(ang), math.sin(ang)
    claw_scale = 0.66 * S * k  # claw local units → pixels
    back = 0.42 * claw_scale
    cable_end = (grab[0] - ux * back, grab[1] - uy * back)
    start = (cable_end[0] - ux * 0.42 * S * k, cable_end[1] - uy * 0.42 * S * k)
    d.line([start, cable_end], fill=ROPE, width=int(22 * k))

    # Gauntlet glow at the rope start
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    r = 0.07 * S * k
    gd.ellipse([start[0] - r, start[1] - r, start[0] + r, start[1] + r], fill=CYAN + (170,))
    glow = glow.filter(ImageFilter.GaussianBlur(0.03 * S * k))
    img.paste(glow, (0, 0), glow)
    d = ImageDraw.Draw(img)
    r = 0.028 * S * k
    d.ellipse([start[0] - r, start[1] - r, start[0] + r, start[1] + r], fill=(235, 255, 255))

    # Claw (same keyframes as src/claw.ts, closed: gripping)
    def L(x, y):  # claw local → pixels (local +x along the throw, tips at x≈0)
        return (grab[0] + (x * ux - y * uy) * claw_scale, grab[1] + (x * uy + y * ux) * claw_scale)

    pivot = (-0.17, -0.055)
    closed = [(-0.07, -0.11), (-0.005, -0.04), (-0.025, -0.005)]
    opened = [(-0.09, -0.21), (0.03, -0.215), (0.045, -0.15)]
    grip = [lerp(c, o, 0.35) for c, o in zip(closed, opened)]  # slightly open, gripping wood

    def prong(flip, color, w_outer, w_inner, yscale=1.0):
        pts = [pivot] + grip
        pts = [L(x, y * flip * yscale) for x, y in pts]
        d.line(pts, fill=CHROME_DARK, width=int(w_outer * claw_scale), joint='curve')
        for p in (pts[0], pts[-1]):
            rr = w_outer * claw_scale / 2
            d.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=CHROME_DARK)
        d.line(pts, fill=color, width=int(w_inner * claw_scale), joint='curve')

    prong(1, (154, 163, 177), 0.07, 0.04, yscale=0.35)
    prong(-1, CHROME, 0.075, 0.042)
    prong(1, CHROME, 0.075, 0.042)

    d.line([L(-0.42, 0), L(-0.3, 0)], fill=CHROME_DARK, width=int(0.055 * claw_scale))
    hub_o = [(-0.33, -0.05), (-0.31, -0.10), (-0.25, -0.11), (-0.15, -0.09), (-0.15, 0.09), (-0.25, 0.11), (-0.31, 0.10), (-0.33, 0.05)]
    hub_i = [(-0.315, -0.045), (-0.3, -0.083), (-0.25, -0.09), (-0.165, -0.075), (-0.165, 0.075), (-0.25, 0.09), (-0.3, 0.083), (-0.315, 0.045)]
    d.polygon([L(*p) for p in hub_o], fill=CHROME_DARK)
    d.polygon([L(*p) for p in hub_i], fill=CHROME)
    d.polygon([L(-0.29, -0.065), L(-0.2, -0.065), L(-0.2, -0.04), L(-0.29, -0.04)], fill=CHROME_HI)
    d.polygon([L(-0.19, -0.085), L(-0.155, -0.085), L(-0.155, 0.085), L(-0.19, 0.085)], fill=COLLAR)
    for s in (-1, 1):
        c = L(pivot[0], pivot[1] * s)
        rr = 0.024 * claw_scale
        d.ellipse([c[0] - rr, c[1] - rr, c[0] + rr, c[1] + rr], fill=CHROME_DARK)
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    plain = draw_icon(maskable=False)
    mask = draw_icon(maskable=True)
    for size in (180, 192, 512):
        name = 'apple-touch-icon.png' if size == 180 else f'icon-{size}.png'
        plain.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
    mask.resize((512, 512), Image.LANCZOS).save(OUT / 'icon-maskable-512.png', optimize=True)
    plain.resize((32, 32), Image.LANCZOS).save(OUT / 'favicon-32.png', optimize=True)
    print('wrote', sorted(p.name for p in OUT.iterdir()))


if __name__ == '__main__':
    main()
