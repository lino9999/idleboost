#!/usr/bin/env python3
"""Rasterize icona.svg (a simple gradient lightning bolt) into icon.ico + icon.png."""
import math
from PIL import Image, ImageDraw, ImageFilter

# Bolt polygon vertices (256x256 viewBox coordinates)
pts_256 = [
    (128, 20),
    (210, 110),
    (145, 110),
    (160, 230),
    (46, 125),
    (110, 125),
]

SCALE = 2.0  # render at 512 for smoother downscale
SIZE = int(256 * SCALE)
pts = [(x * SCALE, y * SCALE) for x, y in pts_256]

# Gradient stops (objectBoundingBox)
# bbox of bolt: x 46..210 (w 164), y 20..230 (h 210)
bbox_x0, bbox_y0 = 46.0, 20.0
bbox_w, bbox_h = 164.0, 210.0
g_start = (bbox_x0 + 0.10 * bbox_w, bbox_y0 + 1.0 * bbox_h)   # (62.4, 230)
g_end = (bbox_x0 + 0.90 * bbox_w, bbox_y0 + 0.0 * bbox_h)     # (193.6, 20)

def hex2rgb(h):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

stops = [
    (0.0, hex2rgb('#1b2838')),
    (0.4, hex2rgb('#2a475e')),
    (1.0, hex2rgb('#66c0f4')),
]

def gradient_color(t):
    t = max(0.0, min(1.0, t))
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        if t0 <= t <= t1:
            f = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
            return tuple(int(round(c0[j] + (c1[j] - c0[j]) * f)) for j in range(3))
    return stops[-1][1]

# Gradient axis
dx = g_end[0] - g_start[0]
dy = g_end[1] - g_start[1]
len2 = dx * dx + dy * dy

# Create gradient for the whole canvas as a lookup
def make_gradient_canvas(w, h):
    grad = Image.new('RGB', (w, h))
    gd = grad.load()
    for yy in range(h):
        for xx in range(w):
            # project point onto axis, normalized
            if len2 > 0:
                t = ((xx - g_start[0] * SCALE) * dx + (yy - g_start[1] * SCALE) * dy) / (len2 * SCALE)
            else:
                t = 0.0
            gd[xx, yy] = gradient_color(t)
    return grad

def point_in_polygon(x, y, poly):
    n = len(poly)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside

# Build an RGBA image
canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
px = canvas.load()
grad = make_gradient_canvas(SIZE, SIZE).load()
for yy in range(SIZE):
    for xx in range(SIZE):
        if point_in_polygon(xx + 0.5, yy + 0.5, pts):
            r, g, b = grad[xx, yy]
            px[xx, yy] = (r, g, b, 255)

# Stroke the outline
draw = ImageDraw.Draw(canvas)
stroke = hex2rgb('#c7d5e0')
draw.line(pts + [pts[0]], fill=(stroke[0], stroke[1], stroke[2], 255), width=max(2, int(3 * SCALE)), joint='curve')

# Drop shadow: render the bolt filled black, blurred, offset, placed beneath
shadow = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
off = (int(2 * SCALE), int(5 * SCALE))
shifted = [(x + off[0], y + off[1]) for x, y in pts]
sd.polygon(shifted, fill=(0, 0, 0, 120))
shadow = shadow.filter(ImageFilter.GaussianBlur(4 * SCALE))
canvas = Image.alpha_composite(shadow, canvas)

# Downscale to 256
icon = canvas.resize((256, 256), Image.LANCZOS)

# Save png + multi-size ico
import os
os.makedirs('build', exist_ok=True)
icon.save('build/icon.png', 'PNG')
sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
icon.save('build/icon.ico', format='ICO', sizes=sizes)
print('Generated build/icon.png and build/icon.ico')