#!/usr/bin/env python3
"""Genere le sprite SVG des pions (bloc <svg> en tete de index.html).

Pion en bois tourne : bas du cone creuse d'une gorge (bourrelet), corps en
cloche, collerette en bourrelet arrondi, tete spherique a dessus plat. La vue
est calculee (projection orthographique) comme pour un joueur penche sur le
plateau : ELEVATION degres au-dessus de l'horizon.

Les dimensions reelles sont dans PROFIL ci-dessous ; relancer apres
modification :   python3 tools/make-pawns.py
Le point de contact au sol est (CX, Y0) dans le viewBox 0 0 100 120 :
app.css place ce point au centre de la case.
"""
import math
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(os.path.dirname(HERE), "index.html")

ELEVATION = 55                    # degres
CX, Y0 = 50, 90                   # point de contact au sol dans le viewBox
OUTLINE = 3.2                     # epaisseur des contours, en unites du viewBox (~1,5 px sur telephone)

# Profil reel (unites libres) : hauteurs h depuis le sol, rayons r.
PROFIL = {
    "pied": 27,                   # rayon du bourrelet = bas du cone
    "pied_h": 9,                  # hauteur du bourrelet
    "gorge": (9, 11.5, 0.8),      # gorge : de h, a h, profondeur
    "cou": (70, 8.5),             # haut du corps : h, r
    "collerette": (70, 17, 3.2),  # centre h, rayon, demi-epaisseur
    "tete": (95, 19),             # centre h, rayon
    "dessus": (112, 8.5),         # dessus plat : h, r
}

C, S = math.cos(math.radians(ELEVATION)), math.sin(math.radians(ELEVATION))


def f(v):
    return ("%.1f" % v).rstrip("0").rstrip(".")


def yc(h):
    return Y0 - h * C


def ell(h, r):
    return (yc(h), r, r * S)


def band(lo, hi):
    """Bande avant d'un cylindre court entre deux cercles (vus en ellipses)."""
    (y1, rx1, ry1), (y2, rx2, ry2) = lo, hi
    return (f"M{f(CX - rx1)} {f(y1)} A{f(rx1)} {f(ry1)} 0 0 0 {f(CX + rx1)} {f(y1)} "
            f"L{f(CX + rx2)} {f(y2)} A{f(rx2)} {f(ry2)} 0 0 1 {f(CX - rx2)} {f(y2)} Z")


def shapes():
    P = PROFIL
    R = P["pied"]
    g0, g1, gd = P["gorge"]
    hn, rn = P["cou"]
    hc, rc, tc = P["collerette"]
    ht, rt = P["tete"]
    hd, rd = P["dessus"]

    yb, _, ryb = ell(g1, R)
    ytop = yc(hn)
    body = (f"M{f(CX - R)} {f(yb)} C{f(CX - R + 0.3)} {f(yb - 13)} {f(CX - rn - 6)} {f(ytop + 9)} {f(CX - rn)} {f(ytop)} "
            f"H{f(CX + rn)} C{f(CX + rn + 6)} {f(ytop + 9)} {f(CX + R - 0.3)} {f(yb - 13)} {f(CX + R)} {f(yb)} "
            f"A{f(R)} {f(ryb)} 0 0 1 {f(CX - R)} {f(yb)} Z")
    # Collerette = tore : vue d'en haut, une ellipse dont l'epaisseur ajoute
    # tc*C en haut et en bas. Le trou est cache par la tete.
    cy = yc(hc)
    return {
        "pw-foot": ("path", f'd="{band(ell(0, R), ell(P["pied_h"], R))}"'),
        # dessus du bourrelet : sans lui, un liseré du plateau apparait entre le
        # pied et le fond de la gorge (plus etroite)
        "pw-foot-top": ("ellipse", f'cx="{CX}" cy="{f(yc(P["pied_h"]))}" rx="{f(R)}" ry="{f(R * S)}"'),
        "pw-groove": ("path", f'd="{band(ell(g0, R - gd), ell(g1, R - gd))}"'),
        "pw-body": ("path", f'd="{body}"'),
        "pw-collar": ("ellipse", f'cx="{CX}" cy="{f(cy)}" rx="{f(rc)}" ry="{f(rc * S + tc * C)}"'),
        "pw-head": ("circle", f'cx="{CX}" cy="{f(yc(ht))}" r="{f(rt)}"'),
        "pw-top": ("ellipse", f'cx="{CX}" cy="{f(yc(hd))}" rx="{f(rd)}" ry="{f(rd * S)}"'),
    }, {
        "body_ao": (yc(g1) + 1.5, R, R * S),
        "collar_ao": (yc(hc) + 3, rc - 3, rc * S - 3),
        "head_ao": (yc(hc) + 1, rc - 2, rc * S - 3),
    }


LINE = 'stroke="#2A1606" stroke-opacity="0.35" stroke-width="0.6"'


def ao(e, op):
    y, rx, ry = e
    return (f'\n    <ellipse cx="{CX}" cy="{f(y)}" rx="{f(rx)}" ry="{f(ry)}" fill="#000" '
            f'opacity="{op}" filter="url(#pw-soft)"/>')


def pawn(n, wood, aos):
    W = f"url(#wood-{wood})"
    return (f'  <symbol id="pawn-{n}" viewBox="0 0 100 120">'
            f'\n    <use href="#pw-foot" fill="{W}"/><use href="#pw-foot" fill="url(#pw-cyl)" {LINE}/>'
            f'\n    <use href="#pw-foot-top" fill="{W}"/><use href="#pw-foot-top" fill="#000" fill-opacity="0.4"/>'
            f'\n    <use href="#pw-groove" fill="{W}"/><use href="#pw-groove" fill="url(#pw-cyl)"/><use href="#pw-groove" fill="url(#pw-groove-shade)"/>'
            f'\n    <use href="#pw-body" fill="{W}"/><use href="#pw-body" fill="url(#pw-cyl)"/>'
            f'<use href="#pw-body" fill="url(#pw-body-ao)" {LINE}/>'
            + ao(aos["collar_ao"], 0.45) +
            f'\n    <use href="#pw-collar" fill="{W}"/><use href="#pw-collar" fill="url(#pw-torus)" {LINE}/>'
            + ao(aos["head_ao"], 0.45) +
            f'\n    <use href="#pw-head" fill="{W}"/><use href="#pw-head" fill="url(#pw-ball)" {LINE}/>'
            f'\n    <use href="#pw-top" fill="#FFF" fill-opacity="0.12" stroke="#2A1606" stroke-opacity="0.2" stroke-width="0.5"/>'
            f'\n  </symbol>\n')


def sprite():
    shp, aos = shapes()
    defs_shapes = "".join(f'\n    <{t} id="{k}" {a}/>' for k, (t, a) in shp.items())
    R = PROFIL["pied"]
    defs_shapes += (f'\n    <ellipse id="pw-shadow" cx="{CX + 7}" cy="{f(Y0 + 4)}" rx="{R + 3}" '
                    f'ry="{f((R + 3) * S)}" fill="#000" opacity="0.5" filter="url(#pawn-blur)"/>')
    return f'''<!-- Pions en bois tourne : genere par tools/make-pawns.py (ne pas editer a la main).
     Bas du cone creuse d'une gorge, corps en cloche, collerette en bourrelet,
     tete a dessus plat, vus d'en haut ({ELEVATION} deg). Bois mat eclaire du haut-gauche.
     Reutilises par <use href="#pawn-1|2"> (viewBox 0 0 100 120 ; contact au sol
     en {CX},{Y0}). Chaque partie est peinte en entier (bois, volume, contour)
     avant la suivante : c'est ce qui cache les aretes de derriere. -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <defs>
    <filter id="pawn-blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="2.6"/></filter>
    <!-- contours (dernier coup, capture) : silhouette dilatee du meme rayon dans
         toutes les directions, donc d'epaisseur egale tout autour -->
    <filter id="pw-outline-last" x="-10%" y="-10%" width="120%" height="120%">
      <feMorphology in="SourceAlpha" operator="dilate" radius="{OUTLINE}" result="d"/>
      <feFlood flood-color="#FFFFFF"/><feComposite in2="d" operator="in" result="o"/>
      <feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="pw-outline-cap" x="-10%" y="-10%" width="120%" height="120%">
      <feMorphology in="SourceAlpha" operator="dilate" radius="{OUTLINE}" result="d"/>
      <feFlood flood-color="#EF6A5E"/><feComposite in2="d" operator="in" result="o"/>
      <feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="pw-soft" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="1.4"/></filter>
    <!-- fil du bois vertical (le long de l'axe du pion), peu contraste : bois mat -->
    <filter id="grain-maple" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.28 0.022" numOctaves="3" seed="5"/>
      <feColorMatrix values="0 0 0 0 0.4  0 0 0 0 0.22  0 0 0 0 0.08  1.7 0 0 0 -0.72"/>
    </filter>
    <filter id="grain-walnut" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.28 0.022" numOctaves="3" seed="9"/>
      <feColorMatrix values="0 0 0 0 0.66  0 0 0 0 0.4  0 0 0 0 0.2  1.8 0 0 0 -0.8"/>
    </filter>
    <pattern id="wood-maple" patternUnits="userSpaceOnUse" width="100" height="120">
      <rect width="100" height="120" fill="#D6A96C"/>
      <rect width="100" height="120" filter="url(#grain-maple)"/>
    </pattern>
    <pattern id="wood-walnut" patternUnits="userSpaceOnUse" width="100" height="120">
      <rect width="100" height="120" fill="#5A341B"/>
      <rect width="100" height="120" filter="url(#grain-walnut)" opacity="0.5"/>
    </pattern>
    <!-- volume : piece tournee eclairee du haut-gauche, sans brillance -->
    <linearGradient id="pw-cyl">
      <stop offset="0" stop-color="#000" stop-opacity="0.5"/>
      <stop offset="0.2" stop-color="#FFF" stop-opacity="0.22"/>
      <stop offset="0.36" stop-color="#FFF" stop-opacity="0.08"/>
      <stop offset="0.56" stop-color="#000" stop-opacity="0"/>
      <stop offset="0.82" stop-color="#000" stop-opacity="0.3"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.62"/>
    </linearGradient>
    <linearGradient id="pw-body-ao" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.3"/>
      <stop offset="0.12" stop-color="#000" stop-opacity="0"/>
      <stop offset="0.85" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.3"/>
    </linearGradient>
    <!-- gorge creusee : levre du haut dans l'ombre, levre du bas eclairee (le bois reste visible) -->
    <linearGradient id="pw-groove-shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.42"/>
      <stop offset="0.55" stop-color="#000" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#FFF" stop-opacity="0.22"/>
    </linearGradient>
    <!-- bourrelet : arrete claire en haut a gauche, ombre en bas -->
    <radialGradient id="pw-torus" cx="0.42" cy="0.38" r="0.62">
      <stop offset="0" stop-color="#000" stop-opacity="0.25"/>
      <stop offset="0.62" stop-color="#FFF" stop-opacity="0.05"/>
      <stop offset="0.8" stop-color="#FFF" stop-opacity="0.24"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.5"/>
    </radialGradient>
    <radialGradient id="pw-ball" cx="0.36" cy="0.34" r="0.8">
      <stop offset="0" stop-color="#FFF" stop-opacity="0.34"/>
      <stop offset="0.3" stop-color="#FFF" stop-opacity="0.08"/>
      <stop offset="0.6" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.58"/>
    </radialGradient>
    <!-- formes -->{defs_shapes}
  </defs>
{pawn(1, "maple", aos)}{pawn(2, "walnut", aos)}  <!-- ombre portee a part : les contours (dernier coup, capture) ne l'entourent pas -->
  <symbol id="pawn-shadow" viewBox="0 0 100 120"><use href="#pw-shadow"/></symbol>
</svg>
'''


def main():
    html = open(INDEX, encoding="utf-8").read()
    pat = re.compile(r"<!-- Pions en bois tourne.*?</svg>\n", re.S)
    if not pat.search(html):
        raise SystemExit("bloc du sprite introuvable dans index.html")
    html = pat.sub(lambda m: sprite(), html, count=1)
    open(INDEX, "w", encoding="utf-8").write(html)
    print("sprite des pions regenere dans", INDEX)


if __name__ == "__main__":
    main()
