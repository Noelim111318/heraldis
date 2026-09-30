#!/usr/bin/env python3
"""Genere les icones PWA de Heraldis : un coin de plateau en bois (2 x 2 cases,
deux Alliances bicolores et deux Maisons bordees d'or) avec un pion clair
(erable) et un pion fonce (noyer) debout, sur le fond nuit de l'app. Les
pions viennent de tools/pawn-*.png, rendus depuis le sprite SVG du jeu. Les emblemes
des Maisons viennent de crests/*.png (sous les pions, comme en jeu).

Sorties (a la racine du projet) :
    icons/icon-192.png
    icons/icon-512.png
    icons/icon-512-maskable.png   (motif reduit + marge de securite)
    icons/apple-touch-icon.png    (180x180, opaque)
    favicon.ico                   (16 / 32 / 48 / 64)

Depend seulement de Pillow :  python3 -m pip install pillow
Le grain du bois est procedural (bruit etire + veines ondulees), sans numpy.
"""
import math
import os
import random

try:
    from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps
except ImportError:
    raise SystemExit("Pillow requis :  python3 -m pip install pillow")

try:
    LANCZOS = Image.Resampling.LANCZOS
    BICUBIC = Image.Resampling.BICUBIC
except AttributeError:                       # Pillow < 9.1
    LANCZOS = Image.LANCZOS
    BICUBIC = Image.BICUBIC

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ICONS = os.path.join(ROOT, "icons")

S = 1024                                     # resolution de travail

# ------------------------------------------------------------------ couleurs
BG_TOP = (26, 30, 54)                        # fond nuit (comme l'app)
BG_LOW = (11, 13, 25)
GLOW = (201, 150, 46)
GOLD = (232, 184, 74)

FRAME = ((58, 34, 18), (122, 78, 42))        # noyer : sombre, clair

LOUP, AIGLE, OURS, CERF, SANGLIER = (94, 115, 152), (201, 150, 46), (134, 87, 58), (74, 132, 88), (160, 65, 60)

CREAM = (245, 234, 210)                      # couleur des emblemes
CRESTS = os.path.join(ROOT, "crests")        # silhouettes (crests/<nom>.png)

# 2 x 2 cases : (couleur 1, couleur 2 ou None = Maison, pion 0/1/2, emblemes)
CELLS = [
    (LOUP, AIGLE, 1, ("loup", "aigle")), (CERF, None, 0, ("cerf",)),
    (OURS, SANGLIER, 0, ("ours", "sanglier")), (SANGLIER, None, 2, ("sanglier",)),
]


# ------------------------------------------------------------------ bois
def grain(w, h, seed, fiber=60, veins=26):
    """Texture de grain en niveaux de gris (L), fibres horizontales."""
    rnd = random.Random(seed)
    random.seed(seed)
    # fibres : bruit tres etire horizontalement
    small = Image.effect_noise((max(4, w // fiber), h), 70).resize((w, h), BICUBIC)
    base = ImageOps.autocontrast(small, cutoff=2).point(lambda v: 150 + v * 105 // 255)
    # veines : lignes ondulees plus sombres
    lines = Image.new("L", (w, h), 255)
    d = ImageDraw.Draw(lines)
    y = rnd.uniform(0, h / veins)
    while y < h + 20:
        amp = rnd.uniform(h * 0.004, h * 0.02)
        freq = rnd.uniform(1.0, 3.0) * 2 * math.pi / w
        ph = rnd.uniform(0, 2 * math.pi)
        drift = rnd.uniform(-0.04, 0.04) * h
        pts = [(x, y + amp * math.sin(x * freq + ph) + drift * x / w) for x in range(-10, w + 11, 8)]
        d.line(pts, fill=rnd.randint(95, 175), width=max(1, int(rnd.uniform(0.002, 0.007) * h)))
        y += rnd.uniform(0.4, 1.6) * h / veins
    lines = lines.filter(ImageFilter.GaussianBlur(max(1, h // 400)))
    return ImageChops.multiply(base, lines)


def wood(w, h, dark, light, seed, angle=0):
    g = grain(w, h, seed)
    if angle:
        big = grain(int(w * 1.5), int(h * 1.5), seed).rotate(angle, resample=BICUBIC)
        g = big.crop((int(w * 0.25), int(h * 0.25), int(w * 0.25) + w, int(h * 0.25) + h))
    return ImageOps.colorize(g, dark, light).convert("RGBA")


# ------------------------------------------------------------------ helpers
def vgrad(w, h, top, bot):
    base = Image.new("RGB", (w, h), top)
    grad = Image.new("L", (1, h))
    for y in range(h):
        grad.putpixel((0, y), int(255 * y / max(1, h - 1)))
    return Image.composite(Image.new("RGB", (w, h), bot), base, grad.resize((w, h)))


def rrect_mask(box, radius):
    m = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle(box, radius=radius, fill=255)
    return m


def stroke(img, shape, box, **kw):
    """Trace un contour semi-transparent en le melangeant (ImageDraw remplace les pixels)."""
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    getattr(ImageDraw.Draw(layer), shape)(box, **kw)
    img.alpha_composite(layer)


def shadow(img, mask, dy, blur, alpha):
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sh.paste((0, 0, 0, alpha), (0, int(dy)), mask)
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(int(blur))))


def background():
    img = vgrad(S, S, BG_TOP, BG_LOW).convert("RGBA")
    g = Image.radial_gradient("L").resize((int(S * 2.2), int(S * 2.2)), LANCZOS)
    glow_a = Image.new("L", (S, S), 0)
    glow_a.paste(g, (int(S * 0.5 - g.width / 2), int(S * 0.2 - g.height / 2)))
    glow_a = glow_a.point(lambda v: int(v * 0.40))
    return Image.composite(Image.new("RGBA", (S, S), GLOW + (255,)), img, glow_a)


def put_crest(img, name, cx, cy, size):
    """Pose un embleme creme centre en (cx, cy)."""
    path = os.path.join(CRESTS, name + ".png")
    if not os.path.exists(path):
        return
    a = Image.open(path).getchannel("A").resize((int(size), int(size)), LANCZOS)
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    x, y = int(cx - size / 2), int(cy - size / 2)
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sh.paste((0, 0, 0, 120), (x, y + max(1, int(size * 0.03))), a)
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(max(1, int(size * 0.02)))))
    layer.paste(CREAM + (255,), (x, y), a)
    img.alpha_composite(layer)


def paint_cell(img, box, c1, c2, seed, crests=()):
    x0, y0, x1, y1 = [int(v) for v in box]
    w, h = x1 - x0, y1 - y0
    tile = Image.new("RGBA", (w, h), c1 + (255,))
    if c2:                                    # Alliance : coupee en diagonale
        ImageDraw.Draw(tile).polygon([(w, 0), (w, h), (0, h)], fill=c2 + (255,))
    # bois peint : le grain transparait
    g = grain(w, h, seed).point(lambda v: 150 + v * 105 // 255)
    tile = ImageChops.multiply(tile, Image.merge("RGBA", (g, g, g, Image.new("L", (w, h), 255))))
    radius = w * 0.12
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    img.paste(tile, (x0, y0), m)
    if len(crests) == 1:                      # Maison : embleme au centre
        put_crest(img, crests[0], x0 + w / 2, y0 + h / 2, w * 0.66)
    elif len(crests) == 2:                    # Alliance : un embleme par moitie
        put_crest(img, crests[0], x0 + w * 0.29, y0 + h * 0.29, w * 0.46)
        put_crest(img, crests[1], x0 + w * 0.71, y0 + h * 0.71, w * 0.46)
    if not c2:                                # Maison : liseré d'or
        stroke(img, "rounded_rectangle", [x0, y0, x1 - 1, y1 - 1], radius=radius, outline=GOLD + (255,), width=max(2, int(w * 0.06)))
    else:
        stroke(img, "rounded_rectangle", [x0, y0, x1 - 1, y1 - 1], radius=radius, outline=(0, 0, 0, 110), width=max(1, int(w * 0.015)))


def pawn(img, box, p):
    """Pose le pion (tools/pawn-light.png / pawn-dark.png, rendus depuis le
    sprite SVG d'index.html) debout dans la case, comme en jeu."""
    path = os.path.join(HERE, "pawn-light.png" if p == 1 else "pawn-dark.png")
    x0, y0, x1, y1 = box
    cw = x1 - x0
    w = cw * 0.80
    h = w * 1.2                              # viewBox du sprite : 100 x 120
    im = Image.open(path).convert("RGBA").resize((int(w), int(h)), LANCZOS)
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    # comme en jeu : le point de contact (75 % de la hauteur) au centre de la case
    layer.paste(im, (int(x0 + (cw - w) / 2), int(y0 + cw / 2 - h * 0.75)), im)
    img.alpha_composite(layer)


def draw_board(img, scale):
    bw = S * 0.80 * scale
    x0, y0 = (S - bw) / 2, (S - bw) / 2
    x1, y1 = x0 + bw, y0 + bw
    radius = bw * 0.11
    frame_mask = rrect_mask([x0, y0, x1, y1], radius)
    shadow(img, frame_mask, S * 0.02, S * 0.035, 180)

    fr = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fr.paste(wood(int(bw) + 2, int(bw) + 2, FRAME[0], FRAME[1], 7, angle=8), (int(x0), int(y0)))
    img.paste(fr, (0, 0), frame_mask)
    stroke(img, "rounded_rectangle", [x0, y0, x1, y1], radius=radius, outline=(156, 116, 34, 255), width=max(3, int(bw * 0.018)))

    pad = bw * 0.085
    gap = bw * 0.045
    cw = (bw - 2 * pad - gap) / 2
    for k, (c1, c2, p, crests) in enumerate(CELLS):
        r, c = divmod(k, 2)
        cx0 = x0 + pad + c * (cw + gap)
        cy0 = y0 + pad + r * (cw + gap)
        paint_cell(img, (cx0, cy0, cx0 + cw, cy0 + cw), c1, c2, 20 + k, crests)
        if p:
            pawn(img, (cx0, cy0, cx0 + cw, cy0 + cw), p)


def compose(size, maskable=False, opaque=False):
    img = background()
    draw_board(img, 0.74 if maskable else 1.0)

    if not maskable and not opaque:
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
        img.putalpha(Image.composite(img.getchannel("A"), Image.new("L", (S, S), 0), mask))

    img = img.resize((size, size), LANCZOS)
    if opaque:
        out = Image.new("RGB", img.size, BG_LOW)
        out.paste(img, (0, 0), img)
        return out
    return img


def main():
    os.makedirs(ICONS, exist_ok=True)
    compose(192).save(os.path.join(ICONS, "icon-192.png"))
    compose(512).save(os.path.join(ICONS, "icon-512.png"))
    compose(512, maskable=True).save(os.path.join(ICONS, "icon-512-maskable.png"))
    compose(180, opaque=True).save(os.path.join(ICONS, "apple-touch-icon.png"))
    compose(64, opaque=True).save(os.path.join(ROOT, "favicon.ico"),
                                  sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print("Icones regenerees dans", ICONS, "+ favicon.ico")


if __name__ == "__main__":
    main()
