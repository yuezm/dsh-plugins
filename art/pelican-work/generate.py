#!/usr/bin/env python3
"""Generate the California brown pelican riding a bicycle illustration (v2)."""
import math
from pathlib import Path

W, H = 1500, 1000
OUT = Path(__file__).with_name("pelican.svg")

REAR = (425.0, 722.0)
FRONT = (1045.0, 722.0)
BB = (680.0, 755.0)
SEAT = (590.0, 505.0)
HEAD_TOP = (952.0, 478.0)
HEAD_BOT = (978.0, 546.0)

BODY_D = ("M 580 490 C 560 440 575 380 620 345 C 670 310 735 308 772 345 "
          "C 805 378 820 420 810 455 C 798 495 755 520 705 520 "
          "C 660 520 605 515 580 490 Z")
NECK_D = ("M 740 380 C 748 330 762 280 790 250 C 802 225 820 202 846 192 "
          "C 864 184 884 188 898 200 C 916 214 926 236 922 256 "
          "C 918 274 900 286 878 286 C 866 312 860 350 854 390 "
          "C 848 420 830 440 810 452 C 790 460 760 430 740 380 Z")
HEAD_PATCH = ("M 802 254 C 794 222 804 196 830 184 C 856 172 884 178 902 196 "
              "C 920 214 924 240 914 258 C 902 276 880 284 858 278 "
              "C 834 272 814 264 802 254 Z")
HEAD_D = HEAD_PATCH
POUCH_D = ("M 890 286 C 896 320 912 356 936 384 C 962 414 996 420 1028 408 "
           "C 1068 392 1104 360 1128 326 C 1142 304 1150 280 1152 258 "
           "C 1082 250 1000 244 922 232 C 908 238 898 250 892 264 "
           "C 888 272 888 280 890 286 Z")
WING_D = ("M 752 352 C 735 320 710 292 680 272 C 655 256 625 250 600 258 "
          "C 590 264 588 274 592 284 C 600 300 606 318 610 336 "
          "C 620 370 642 398 670 418 C 690 432 715 438 735 432 "
          "C 748 428 754 416 752 404 C 746 388 744 370 748 360 Z")


def f(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


def pt(cx, cy, r, deg):
    a = math.radians(deg)
    return cx + r * math.cos(a), cy + r * math.sin(a)


def line(x1, y1, x2, y2, **attrs):
    a = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in attrs.items())
    return f'<line x1="{f(x1)}" y1="{f(y1)}" x2="{f(x2)}" y2="{f(y2)}" {a}/>'


def feather(bx, by, angle, length, width, fill, edge="#c6ad88", sw=1.4,
            shaft=True, opacity=1.0):
    a = math.radians(angle)
    dx, dy = math.cos(a), math.sin(a)
    px, py = -dy, dx
    tx, ty = bx + dx * length, by + dy * length
    p0 = (bx + px * width / 2, by + py * width / 2)
    p1 = (bx - px * width / 2, by - py * width / 2)
    c1 = (bx + dx * length * 0.46 + px * width * 0.58,
          by + dy * length * 0.46 + py * width * 0.58)
    c2 = (bx + dx * length * 0.56 - px * width * 0.58,
          by + dy * length * 0.56 - py * width * 0.58)
    d = (f"M {f(p0[0])} {f(p0[1])} Q {f(c1[0])} {f(c1[1])} {f(tx)} {f(ty)} "
         f"Q {f(c2[0])} {f(c2[1])} {f(p1[0])} {f(p1[1])} Z")
    out = [f'<path d="{d}" fill="{fill}" stroke="{edge}" stroke-width="{sw}" '
           f'stroke-opacity="0.75" opacity="{opacity}"/>']
    if shaft:
        sx, sy = bx + dx * length * 0.16, by + dy * length * 0.16
        ex, ey = bx + dx * length * 0.84, by + dy * length * 0.84
        out.append(f'<path d="M {f(sx)} {f(sy)} L {f(ex)} {f(ey)}" '
                   f'stroke="{edge}" stroke-width="0.9" stroke-opacity="0.5"/>')
    return "".join(out)


def plume(bx, by, angle, length, width, fill, edge="#cbb08a", sw=1.1):
    a = math.radians(angle)
    cx = bx + math.cos(a) * length / 2
    cy = by + math.sin(a) * length / 2
    return (f'<g transform="translate({f(cx)} {f(cy)}) rotate({f(angle)})">'
            f'<ellipse cx="0" cy="0" rx="{f(length/2)}" ry="{f(width/2)}" '
            f'fill="{fill}" stroke="{edge}" stroke-width="{sw}" stroke-opacity="0.6"/>'
            f'<line x1="{f(-length*0.38)}" y1="0" x2="{f(length*0.38)}" y2="0" '
            f'stroke="{edge}" stroke-width="0.9" opacity="0.45"/></g>')


def wheel(cx, cy, spokes=36):
    out = [f'<g id="wheel-{int(cx)}">']
    out.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="150" fill="none" '
               f'stroke="#26241f" stroke-width="16"/>')
    out.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="150" fill="none" '
               f'stroke="#4d483f" stroke-width="3" stroke-dasharray="2 11" '
               f'opacity="0.5"/>')
    out.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="141" fill="none" '
               f'stroke="#e9ddc3" stroke-width="9"/>')
    out.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="141" fill="none" '
               f'stroke="#c7b795" stroke-width="1.2" opacity="0.7"/>')
    out.append('<g stroke="#c2cbd2" stroke-width="1.35" opacity="0.95">')
    for i in range(spokes):
        a = i * (360 / spokes) + 2.5
        x0, y0 = pt(cx, cy, 18, a)
        x1, y1 = pt(cx, cy, 129, a)
        out.append(line(x0, y0, x1, y1))
    out.append('</g>')
    out.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="132" fill="none" '
               f'stroke="url(#rimGrad)" stroke-width="7"/>')
    out.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="127" fill="none" '
               f'stroke="#7d8990" stroke-width="2"/>')
    out.append(f'<path d="M {f(cx-93)} {f(cy-93)} A 132 132 0 0 1 {f(cx-24)} {f(cy-130)}" '
               f'fill="none" stroke="#f4f7f8" stroke-width="2.4" opacity="0.85"/>')
    out.append(f'<path d="M {f(cx+96)} {f(cy+88)} A 132 132 0 0 1 {f(cx+40)} {f(cy+126)}" '
               f'fill="none" stroke="#eef3f4" stroke-width="1.6" opacity="0.55"/>')
    vx0, vy0 = pt(cx, cy, 133, 250)
    vx1, vy1 = pt(cx, cy, 146, 250)
    out.append(line(vx0, vy0, vx1, vy1, stroke="#c9a24a", stroke_width="4", stroke_linecap="round"))
    out.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="20" fill="url(#hubGrad)" '
               f'stroke="#59646a" stroke-width="2"/>')
    out.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="14" fill="none" '
               f'stroke="#7e8a91" stroke-width="2"/>')
    for i in range(6):
        hx, hy = pt(cx, cy, 9, i * 60 + 15)
        out.append(f'<circle cx="{f(hx)}" cy="{f(hy)}" r="2.2" fill="#4a5257"/>')
    out.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="6.5" fill="#3a4145" '
               f'stroke="#aab5bb" stroke-width="1.2"/>')
    rx, ry = pt(cx, cy, 97, 28)
    out.append(f'<g transform="translate({f(rx)} {f(ry)}) rotate(118)">'
               f'<rect x="-6" y="-11" width="12" height="22" rx="4" fill="#e9a23e" '
               f'stroke="#9a5d18" stroke-width="1.2"/>'
               f'<rect x="-3" y="-7" width="6" height="14" rx="2" fill="#f7d28a"/></g>')
    out.append('</g>')
    return "".join(out)


def ring_teeth(cx, cy, r, n, fill, width=3.2):
    circ = 2 * math.pi * r
    dash = (circ / n * 0.52, circ / n * 0.48)
    return (f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="none" '
            f'stroke="{fill}" stroke-width="{width}" '
            f'stroke-dasharray="{f(dash[0])} {f(dash[1])}"/>')


def scallop_row(y, x0, x1, step, amp, color, opacity=0.45, sw=2.0):
    out = []
    x = x0
    while x <= x1:
        out.append(f'<path d="M {f(x)} {f(y)} q {f(step/2)} {f(amp)} {f(step)} 0" '
                   f'fill="none" stroke="{color}" stroke-width="{sw}" '
                   f'stroke-linecap="round" opacity="{opacity}"/>')
        x += step
    return "".join(out)


def arm_points(p0, p1, n, offset=0):
    out = []
    for i in range(n):
        t = (i + 0.5) / n
        x = p0[0] + (p1[0] - p0[0]) * t
        y = p0[1] + (p1[1] - p0[1]) * t + offset
        out.append((x, y))
    return out


# ---------------------------------------------------------------- background
bg = []
bg.append('<rect width="1500" height="1000" fill="url(#skyGrad)"/>')
bg.append('<circle cx="318" cy="220" r="230" fill="url(#sunGlow)"/>')
bg.append('<circle cx="318" cy="220" r="92" fill="#f9e5b4" opacity="0.95"/>')
bg.append('<circle cx="318" cy="220" r="76" fill="#fceded" opacity="0.55"/>')
bg.append('<g fill="none" stroke="#fff8e6" stroke-linecap="round" opacity="0.55">'
          '<path d="M 640 188 C 700 178 752 182 812 176" stroke-width="7"/>'
          '<path d="M 690 208 C 752 200 798 203 850 198" stroke-width="4"/>'
          '<path d="M 1110 148 C 1172 140 1238 142 1300 136" stroke-width="6"/>'
          '<path d="M 1180 170 C 1236 164 1280 166 1328 162" stroke-width="3.5"/>'
          '<path d="M 1010 310 C 1060 304 1110 306 1152 301" stroke-width="4" opacity="0.7"/>'
          '</g>')
bg.append('<rect x="0" y="742" width="1500" height="98" fill="url(#seaGrad)"/>')
bg.append('<path d="M 0 745 C 240 741 480 746 720 744 C 960 742 1230 747 1500 743" '
          'fill="none" stroke="#e8f0e7" stroke-width="3" opacity="0.6"/>')
bg.append('<g stroke="#eaf3ec" stroke-width="2" stroke-linecap="round" opacity="0.55">'
          '<path d="M 560 768 h 42"/><path d="M 640 780 h 26"/><path d="M 760 762 h 55"/>'
          '<path d="M 900 786 h 32"/><path d="M 1180 766 h 46"/><path d="M 1270 790 h 28"/>'
          '<path d="M 1380 770 h 38"/><path d="M 180 782 h 30"/></g>')
# sun path on water
bg.append('<g stroke="#f8e8bd" stroke-linecap="round" opacity="0.35">'
          '<path d="M 286 758 h 58" stroke-width="3"/><path d="M 298 772 h 38" stroke-width="2.5"/>'
          '<path d="M 308 786 h 22" stroke-width="2"/></g>')
# headland
bg.append('<path d="M 0 742 L 0 838 C 52 834 86 816 130 812 C 180 808 216 820 252 832 '
          'C 286 842 318 840 348 836 L 348 742 Z" fill="#9fb198" opacity="0.92"/>')
bg.append('<path d="M 0 800 C 52 792 92 780 136 778 C 190 776 226 794 268 810 '
          'L 268 838 L 0 838 Z" fill="#849b80" opacity="0.5"/>')
bg.append('<g stroke="#71886e" stroke-width="1.6" opacity="0.6" fill="none">'
          '<path d="M 34 806 l -10 -26"/><path d="M 42 808 l 2 -30"/>'
          '<path d="M 50 810 l 12 -24"/><path d="M 210 812 l -8 -22"/>'
          '<path d="M 218 814 l 3 -26"/></g>')
# beach
bg.append('<path d="M 0 830 C 230 822 470 838 740 832 C 1010 826 1250 836 1500 828 '
          'L 1500 1000 L 0 1000 Z" fill="url(#sandGrad)"/>')
bg.append('<path d="M 0 842 C 260 834 500 848 760 842 C 1010 836 1260 846 1500 838" '
          'fill="none" stroke="#f7e9c8" stroke-width="7" opacity="0.5"/>')
bg.append('<path d="M 0 858 C 200 852 380 862 560 858" fill="none" stroke="#d3b784" '
          'stroke-width="2" opacity="0.6"/>')
bg.append('<path d="M 900 862 C 1090 856 1250 866 1500 858" fill="none" stroke="#d3b784" '
          'stroke-width="2" opacity="0.5"/>')
bg.append('<g fill="none" stroke="#d5ba8b" stroke-width="1.6" opacity="0.4">'
          '<path d="M 120 912 c 40 -8 78 -9 120 -3"/>'
          '<path d="M 132 926 c 34 -6 70 -7 108 -2"/>'
          '<path d="M 1240 906 c 46 -8 100 -9 152 -2"/>'
          '<path d="M 1268 922 c 38 -6 82 -6 122 0"/>'
          '<path d="M 700 930 c 54 -7 112 -8 166 -2"/>'
          '<path d="M 742 944 c 44 -5 92 -5 138 -1"/>'
          '</g>')
bg.append('<g opacity="0.7"><path d="M 1206 764 l 0 -22 l 14 22 Z" fill="#f8f4e6"/>'
          '<path d="M 1188 766 l 16 -14 l 0 14 Z" fill="#f8f4e6"/>'
          '<path d="M 1182 766 h 40 l -7 7 h -27 Z" fill="#5f7f7a"/></g>')

shadows = [
    '<ellipse cx="760" cy="878" rx="470" ry="20" fill="#6b5435" opacity="0.24" filter="url(#blur12)"/>',
    '<ellipse cx="425" cy="876" rx="108" ry="10" fill="#524029" opacity="0.3" filter="url(#blur6)"/>',
    '<ellipse cx="1045" cy="876" rx="108" ry="10" fill="#524029" opacity="0.3" filter="url(#blur6)"/>',
    '<ellipse cx="700" cy="884" rx="180" ry="9" fill="#524029" opacity="0.18" filter="url(#blur8)"/>',
]

# ---------------------------------------------------------------- bicycle
bike = []
bike.append('<g id="rear-wheel">' + wheel(*REAR) + '</g>')
bike.append('<g id="front-wheel">' + wheel(*FRONT) + '</g>')

FAR_PEDAL = (603.0, 819.0)
bike.append(f'<g stroke="#59646a" stroke-width="11" stroke-linecap="round">'
            f'<line x1="{BB[0]}" y1="{BB[1]}" x2="{FAR_PEDAL[0]}" y2="{FAR_PEDAL[1]}"/></g>')
bike.append(f'<g transform="translate({FAR_PEDAL[0]} {FAR_PEDAL[1]})">'
            f'<rect x="-27" y="-6" width="54" height="12" rx="4" fill="#343a3e" stroke="#1f2427" stroke-width="2"/>'
            f'<rect x="-23" y="-3" width="46" height="4" rx="2" fill="#8d989e"/></g>')

# far leg emerging from behind the chainstay
bike.append('''<g id="far-leg" stroke="#1c1a18" stroke-width="2">
  <path d="M 648 716 C 638 752 626 788 612 812"
        fill="none" stroke="#2b2825" stroke-width="22" stroke-linecap="round"/>
  <path d="M 648 716 C 638 752 626 788 612 812"
        fill="none" stroke="#4b453e" stroke-width="7" stroke-linecap="round" opacity="0.5"/>
  <path d="M 638 760 q 8 6 15 2 M 630 782 q 8 6 15 2" fill="none" stroke="#5d554c" stroke-width="1.4" opacity="0.7"/>
</g>''')
bike.append('''<g id="far-foot">
  <path d="M 608 808 C 596 814 586 820 584 826 C 588 832 600 831 608 824
           C 616 829 624 826 624 818 C 618 812 612 810 608 808 Z"
        fill="#2e2b27" stroke="#191715" stroke-width="2"/>
  <path d="M 592 820 L 616 820 M 600 812 L 612 826" stroke="#5a544c" stroke-width="1.4" opacity="0.7"/>
</g>''')

frame = []
frame.append(f'<g stroke="#0d3c39" stroke-width="9" stroke-linecap="round" opacity="0.9">'
             f'<line x1="425" y1="715" x2="588" y2="500"/>'
             f'<line x1="425" y1="728" x2="678" y2="748"/>'
             f'<path d="M 974 544 C 984 610 1004 670 1038 718" fill="none"/></g>')
frame.append(f'<g stroke="#0a3330" stroke-width="19" stroke-linecap="round" stroke-linejoin="round" fill="none">'
             f'<line x1="{REAR[0]}" y1="{REAR[1]}" x2="{BB[0]}" y2="{BB[1]}"/>'
             f'<line x1="{REAR[0]}" y1="{REAR[1]}" x2="{SEAT[0]}" y2="{SEAT[1]}"/>'
             f'<line x1="{BB[0]}" y1="{BB[1]}" x2="{SEAT[0]}" y2="{SEAT[1]}"/>'
             f'<line x1="{SEAT[0]}" y1="{SEAT[1]}" x2="{HEAD_TOP[0]}" y2="{HEAD_TOP[1]}"/>'
             f'<line x1="{BB[0]}" y1="{BB[1]}" x2="{HEAD_BOT[0]}" y2="{HEAD_BOT[1]}"/>'
             f'<line x1="{HEAD_TOP[0]}" y1="{HEAD_TOP[1]}" x2="{HEAD_BOT[0]}" y2="{HEAD_BOT[1]}"/>'
             f'<path d="M {HEAD_BOT[0]} {HEAD_BOT[1]} C 988 612 1010 676 1045 722" fill="none"/>'
             f'</g>')
frame.append(f'<g stroke="url(#frameGrad)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none">'
             f'<line x1="{REAR[0]}" y1="{REAR[1]}" x2="{BB[0]}" y2="{BB[1]}"/>'
             f'<line x1="{REAR[0]}" y1="{REAR[1]}" x2="{SEAT[0]}" y2="{SEAT[1]}"/>'
             f'<line x1="{BB[0]}" y1="{BB[1]}" x2="{SEAT[0]}" y2="{SEAT[1]}"/>'
             f'<line x1="{SEAT[0]}" y1="{SEAT[1]}" x2="{HEAD_TOP[0]}" y2="{HEAD_TOP[1]}"/>'
             f'<line x1="{BB[0]}" y1="{BB[1]}" x2="{HEAD_BOT[0]}" y2="{HEAD_BOT[1]}"/>'
             f'<line x1="{HEAD_TOP[0]}" y1="{HEAD_TOP[1]}" x2="{HEAD_BOT[0]}" y2="{HEAD_BOT[1]}"/>'
             f'<path d="M {HEAD_BOT[0]} {HEAD_BOT[1]} C 988 612 1010 676 1045 722" fill="none"/>'
             f'</g>')
frame.append(f'<line x1="{HEAD_TOP[0]}" y1="{HEAD_TOP[1]}" x2="{HEAD_BOT[0]}" y2="{HEAD_BOT[1]}" '
             f'stroke="#0a3330" stroke-width="27" stroke-linecap="round"/>')
frame.append(f'<line x1="{HEAD_TOP[0]}" y1="{HEAD_TOP[1]}" x2="{HEAD_BOT[0]}" y2="{HEAD_BOT[1]}" '
             f'stroke="url(#frameGrad)" stroke-width="20" stroke-linecap="round"/>')
for (lx, ly) in [SEAT, HEAD_TOP, HEAD_BOT, BB]:
    frame.append(f'<circle cx="{lx}" cy="{ly}" r="11" fill="#c9a24a" stroke="#70521f" stroke-width="2"/>')
    frame.append(f'<circle cx="{lx}" cy="{ly}" r="5.5" fill="#e2c37a" opacity="0.8"/>')
for (dx, dy) in [REAR, FRONT]:
    frame.append(f'<circle cx="{dx}" cy="{dy}" r="9" fill="#17544f" stroke="#0a3330" stroke-width="2"/>')
frame.append('<path d="M 604 494 L 944 470" stroke="#79bcb1" stroke-width="2.6" opacity="0.7" fill="none" stroke-linecap="round"/>')
frame.append('<path d="M 687 742 L 963 548" stroke="#5da399" stroke-width="2.6" opacity="0.55" fill="none" stroke-linecap="round"/>')
frame.append('<path d="M 592 518 L 675 742" stroke="#5da399" stroke-width="2.2" opacity="0.4" fill="none" stroke-linecap="round"/>')
frame.append('<g transform="translate(967 512) rotate(15)">'
             '<ellipse cx="0" cy="0" rx="7" ry="12" fill="#d7b25e" stroke="#7c5a25" stroke-width="1.6"/>'
             '<path d="M -3 0 h 6 M 0 -5 v 10" stroke="#7c5a25" stroke-width="1.3" opacity="0.8"/></g>')
bike.append(''.join(frame))

bike.append('<g id="chain" fill="none" stroke-linecap="round">'
            '<path d="M 680 716 L 425 709" stroke="#5b6469" stroke-width="5"/>'
            '<path d="M 680 794 L 425 735" stroke="#5b6469" stroke-width="5"/>'
            '<path d="M 680 716 L 425 709" stroke="#c2cbd0" stroke-width="4.4" stroke-dasharray="2.6 3.4"/>'
            '<path d="M 680 794 L 425 735" stroke="#c2cbd0" stroke-width="4.4" stroke-dasharray="2.6 3.4"/>'
            '</g>')
bike.append(f'<g id="cog"><circle cx="425" cy="722" r="15" fill="#8d989e" stroke="#4c565b" stroke-width="2"/>'
            + ring_teeth(425, 722, 16, 14, "#5b6469", 3.2) +
            f'<circle cx="425" cy="722" r="5" fill="#3b4246"/></g>')
bike.append(f'<g id="chainring">'
            + ring_teeth(BB[0], BB[1], 41, 44, "#8b969c", 4.2) +
            f'<circle cx="{BB[0]}" cy="{BB[1]}" r="36" fill="url(#ringGrad)" stroke="#59646a" stroke-width="2"/>'
            f'<circle cx="{BB[0]}" cy="{BB[1]}" r="31" fill="none" stroke="#b6c0c5" stroke-width="1.4" opacity="0.7"/>')
for i in range(5):
    ax, ay = pt(BB[0], BB[1], 28, i * 72 - 90)
    bike.append(f'<line x1="{BB[0]}" y1="{BB[1]}" x2="{f(ax)}" y2="{f(ay)}" stroke="#7c878d" stroke-width="5" stroke-linecap="round"/>')
bike.append(f'<circle cx="{BB[0]}" cy="{BB[1]}" r="8" fill="#dfe5e8" stroke="#5c666b" stroke-width="1.5"/>'
            f'<circle cx="{BB[0]}" cy="{BB[1]}" r="3" fill="#3f474b"/></g>')

NEAR_PEDAL = (757.0, 691.0)
bike.append(f'<line x1="{BB[0]}" y1="{BB[1]}" x2="{NEAR_PEDAL[0]}" y2="{NEAR_PEDAL[1]}" '
            f'stroke="#2f3437" stroke-width="13" stroke-linecap="round"/>')
bike.append(f'<line x1="{BB[0]}" y1="{BB[1]}" x2="{NEAR_PEDAL[0]}" y2="{NEAR_PEDAL[1]}" '
            f'stroke="#aab4b9" stroke-width="7" stroke-linecap="round"/>')
bike.append(f'<circle cx="{BB[0]}" cy="{BB[1]}" r="9" fill="#d8dfe2" stroke="#4d565a" stroke-width="2"/>')
bike.append(f'''<g id="near-pedal" transform="translate({NEAR_PEDAL[0]} {NEAR_PEDAL[1]})">
  <rect x="-32" y="-8" width="64" height="16" rx="5" fill="#30363a" stroke="#181c1e" stroke-width="2"/>
  <rect x="-28" y="-4" width="56" height="4" rx="2" fill="#9ba6ac"/>
  <rect x="-26" y="3" width="52" height="3" rx="1.5" fill="#5f6a6f"/>
  <circle cx="-18" cy="0" r="2.2" fill="#e9a23e"/>
  <circle cx="19" cy="0" r="2.2" fill="#e9a23e"/>
</g>''')

bike.append(f'<line x1="{SEAT[0]}" y1="{SEAT[1]}" x2="580" y2="494" stroke="#8b979e" stroke-width="10" stroke-linecap="round"/>')
bike.append('''<g id="saddle">
  <path d="M 500 501 C 516 488 556 484 598 487 C 622 489 640 494 632 501
           C 614 511 570 514 536 510 C 516 508 494 507 500 501 Z"
        fill="url(#saddleGrad)" stroke="#39200f" stroke-width="2.5"/>
  <path d="M 512 499 C 536 492 566 491 594 494" fill="none" stroke="#b98055" stroke-width="2" opacity="0.7"/>
  <path d="M 604 490 C 618 492 628 496 622 501" fill="none" stroke="#d2a172" stroke-width="1.6" opacity="0.6"/>
  <g fill="#d9b46a"><circle cx="512" cy="501" r="1.8"/><circle cx="524" cy="498" r="1.8"/>
  <circle cx="608" cy="494" r="1.8"/></g>
</g>''')
bike.append('<path d="M 528 504 C 552 508 572 509 598 507" fill="none" stroke="#8f9aa0" stroke-width="3" opacity="0.8"/>')

bike.append('''<g id="handlebar">
  <path d="M 952 478 L 960 450" stroke="#2f373b" stroke-width="15" stroke-linecap="round"/>
  <path d="M 952 478 L 960 450" stroke="#b9c3c8" stroke-width="9" stroke-linecap="round"/>
  <path d="M 960 450 C 978 442 998 446 1008 458 C 1016 468 1014 482 1002 488
           C 994 492 986 488 984 480"
        fill="none" stroke="#2f373b" stroke-width="15" stroke-linecap="round"/>
  <path d="M 960 450 C 978 442 998 446 1008 458 C 1016 468 1014 482 1002 488
           C 994 492 986 488 984 480"
        fill="none" stroke="#c3ccd1" stroke-width="9" stroke-linecap="round"/>
  <path d="M 978 446 C 992 448 1002 454 1008 462" fill="none" stroke="#eef3f4" stroke-width="2.2" opacity="0.8"/>
  <path d="M 1000 454 C 1010 462 1012 474 1008 482" fill="none" stroke="#6d4326" stroke-width="12" stroke-linecap="round"/>
  <path d="M 1000 454 C 1010 462 1012 474 1008 482" fill="none" stroke="#9a653c" stroke-width="8" stroke-linecap="round"/>
  <path d="M 1003 458 L 1010 474" stroke="#c99763" stroke-width="1.4" opacity="0.7"/>
  <path d="M 1006 462 L 1012 477" stroke="#c99763" stroke-width="1.4" opacity="0.7"/>
  <path d="M 1004 464 C 1012 472 1012 484 1006 492" fill="none" stroke="#8e999f" stroke-width="5" stroke-linecap="round"/>
  <circle cx="1004" cy="463" r="4" fill="#6d787e"/>
  <g transform="translate(946 442)">
    <path d="M -9 2 C -9 -7 9 -7 9 2 Z" fill="#d7b25e" stroke="#7c5a25" stroke-width="1.5"/>
    <circle cx="0" cy="3" r="2" fill="#7c5a25"/>
  </g>
</g>''')

# ---------------------------------------------------------------- near leg (in front of frame, behind body)
leg = []
leg.append('<g id="near-leg">')
leg.append('<path d="M 700 505 C 748 498 788 540 802 582 C 810 602 806 616 794 620 '
           'C 774 626 752 612 742 592 C 728 562 710 532 696 518 '
           'C 690 510 694 506 700 505 Z" fill="url(#thighGrad)" stroke="#241810" stroke-width="3"/>')
leg.append('<g clip-path="url(#thighClip)">')
for y in [528, 553, 578, 603]:
    leg.append(scallop_row(y, 708, 806, 22, 6, "#cbb08a", 0.6, 2.0))
leg.append('<ellipse cx="750" cy="528" rx="34" ry="22" fill="#a9855f" opacity="0.55"/>')
leg.append('<path d="M 720 518 C 748 538 772 566 788 596" fill="none" stroke="#e0c69c" stroke-width="2.2" opacity="0.4"/>')
leg.append('</g>')
leg.append('<path d="M 796 618 C 778 626 754 612 742 592" fill="none" stroke="#dcc095" stroke-width="3" opacity="0.6"/>')
# feather cuff over the tarsus
for i in range(7):
    leg.append(feather(750 + i * 7, 602 + i * 0.4, 74 + i * 5, 42 - i * 2, 23 - i,
                       "#75573c" if i % 2 else "#634830", edge="#e2c79c", sw=1.4))
# tarsus
leg.append('<path d="M 784 616 C 796 624 798 638 794 652 L 776 676 C 772 686 766 690 760 686 '
           'C 755 682 758 674 761 668 L 778 642 C 780 630 776 622 772 614 Z" '
           'fill="url(#legGrad)" stroke="#151311" stroke-width="2.4"/>')
leg.append('<g fill="none" stroke="#5d554c" stroke-width="1.5" opacity="0.75" stroke-linecap="round">'
           '<path d="M 780 626 q 9 6 17 2"/><path d="M 777 642 q 9 6 17 2"/>'
           '<path d="M 773 656 q 8 5 15 2"/></g>')
leg.append('<path d="M 788 628 C 796 638 796 650 792 660" fill="none" stroke="#7b7368" stroke-width="2.6" opacity="0.5"/>')
# foot on the raised pedal
leg.append('<g id="near-foot">')
leg.append('<path d="M 758 674 C 740 684 724 700 716 714 C 724 726 742 728 756 720 '
           'C 770 728 788 726 800 716 C 814 713 820 703 816 694 '
           'C 798 690 784 695 774 702 C 774 690 766 680 762 674 Z" '
           'fill="url(#footGrad)" stroke="#151311" stroke-width="2.6"/>')
leg.append('<path d="M 752 688 C 740 698 730 708 726 714 C 736 718 748 714 756 706 '
           'C 764 714 776 714 784 706 C 772 700 762 694 752 688 Z" '
           'fill="#6f6758" opacity="0.7"/>')
leg.append('<path d="M 758 682 C 748 694 738 706 732 714" fill="none" stroke="#7a7164" stroke-width="1.5" opacity="0.8"/>')
leg.append('<path d="M 760 682 C 770 694 778 702 784 708" fill="none" stroke="#7a7164" stroke-width="1.5" opacity="0.7"/>')
leg.append('<path d="M 736 708 C 752 714 770 716 788 712" fill="none" stroke="#8b8272" stroke-width="2.2" opacity="0.5"/>')
leg.append('<path d="M 716 714 l -6 5 l 7 2" fill="none" stroke="#c9b48d" stroke-width="1.8" stroke-linecap="round"/>')
leg.append('<path d="M 756 720 l -1 7 l 7 -2" fill="none" stroke="#c9b48d" stroke-width="1.8" stroke-linecap="round"/>')
leg.append('<path d="M 816 694 l 6 5 l -8 2" fill="none" stroke="#c9b48d" stroke-width="1.8" stroke-linecap="round"/>')
leg.append('</g></g>')

# ---------------------------------------------------------------- pelican
pel = []
# tail
pel.append('<g id="tail">')
tail_cols = ["#3b2c22", "#46352a", "#35281f", "#4a382b", "#3a2c22", "#433226", "#31251d"]
for i in range(5):
    ang = 211 + i * 5.2
    pel.append(feather(582, 482 - i * 1.5, ang, 100 + (i % 2) * 8, 34 - i * 1.5,
                       tail_cols[i], edge="#cdb48c", sw=1.6))
pel.append('</g>')

# neck (behind body)
pel.append(f'<path d="{NECK_D}" fill="url(#neckGrad)" stroke="#3a1c10" stroke-width="3"/>')
pel.append('<g clip-path="url(#neckClip)">'
           '<path d="M 866 292 C 876 330 870 372 856 408 C 850 424 838 436 828 440 '
           'C 842 428 848 410 852 390 C 858 350 860 312 858 288 Z" '
           'fill="#d08a5d" opacity="0.45"/>'
           '<ellipse cx="840" cy="330" rx="18" ry="66" fill="#d99a6c" opacity="0.2"/></g>')
pel.append('<path d="M 866 290 C 874 330 868 372 854 406 C 848 422 838 434 828 438" '
           'fill="none" stroke="#e8b98d" stroke-width="2.2" opacity="0.45"/>')
pel.append('<path d="M 742 380 C 750 330 764 282 792 252 C 804 228 820 206 844 196 '
           'L 850 203 C 828 218 808 242 796 272 C 784 306 776 346 772 382 Z" '
           'fill="#4b2a1c" opacity="0.85"/>')
pel.append('<g stroke="#b56d45" stroke-width="1.8" stroke-linecap="round" opacity="0.3" fill="none">')
for i in range(9):
    t = i / 8
    x = 794 + 48 * t
    y = 370 - 136 * t
    pel.append(f'<path d="M {f(x-8)} {f(y+10)} q 8 -14 12 -28"/>')
pel.append('</g>')
# breeding yellow foreneck patch
pel.append('<path d="M 820 418 C 814 390 820 364 836 348 C 850 360 858 382 857 408 '
           'C 848 424 832 430 820 418 Z" fill="#e3b64f" stroke="#a8761d" stroke-width="1.5"/>')
pel.append('<path d="M 828 410 C 825 390 831 372 840 361" fill="none" stroke="#f4d98d" stroke-width="2.4" opacity="0.65"/>')
pel.append('<g fill="none" stroke="#b9892e" stroke-width="1.3" opacity="0.55">'
           '<path d="M 828 398 q 10 5 20 1"/><path d="M 827 383 q 12 4 23 -1"/>'
           '<path d="M 831 368 q 10 3 19 -2"/></g>')
pel.append('<path d="M 742 381 C 750 331 764 283 792 253 C 804 229 820 207 844 197" '
           'fill="none" stroke="#e8cfa4" stroke-width="2" opacity="0.5"/>')

# body
pel.append(f'<path d="{BODY_D}" fill="url(#bodyGrad)" stroke="#241810" stroke-width="3.2"/>')
pel.append('<g clip-path="url(#bodyClip)">')
pel.append('<ellipse cx="690" cy="360" rx="118" ry="60" fill="#8a6c50" opacity="0.3"/>')
pel.append('<ellipse cx="610" cy="474" rx="145" ry="48" fill="#2b2018" opacity="0.35"/>')
for row in [(438, 700, 800, 32, 6), (466, 680, 796, 32, 6), (494, 680, 780, 32, 6)]:
    pel.append(scallop_row(row[0], row[1], row[2], row[3], row[4], "#b0916d", 0.5, 2.2))
for row in [(452, 716, 796), (480, 700, 786), (508, 706, 768)]:
    pel.append(scallop_row(row[0], row[1], row[2], 22, 5, "#6f5642", 0.45, 1.6))
pel.append('<ellipse cx="792" cy="430" rx="36" ry="60" fill="#a07a58" opacity="0.32"/>')
pel.append('<g fill="none" stroke="#8b6e51" stroke-width="2" stroke-linecap="round" opacity="0.5">'
           '<path d="M 752 448 q 24 10 50 4"/><path d="M 770 468 q 22 8 46 3"/></g>')
pel.append('</g>')
pel.append('<path d="M 580 486 C 570 430 590 370 630 342 C 675 312 735 315 770 350" '
           'fill="none" stroke="#d9bd92" stroke-width="2.4" opacity="0.4"/>')

# raised wing, half spread for balance
pel.append(f'<path d="{WING_D}" fill="url(#wingGrad)" stroke="#201610" stroke-width="3"/>')
pel.append('<g clip-path="url(#wingClip)">')
pel.append('<path d="M 745 360 C 722 335 698 308 668 286 C 645 270 620 260 600 264 '
           'C 604 292 614 330 634 370 C 654 408 690 430 728 434 '
           'C 742 430 748 416 746 400 C 742 385 742 372 745 360 Z" fill="#4f3a29"/>')
# covert rows along the arm
arm_coverts = [
    (742, 366, 220, 58, 31), (722, 346, 218, 62, 32), (702, 326, 216, 66, 33),
    (680, 307, 214, 70, 34), (658, 290, 212, 74, 35),
]
for bx, by, ang, ln, wd in arm_coverts:
    pel.append(feather(bx, by, ang, ln, wd, "#4f3a29",
                       edge="#d0b48c", sw=1.2, shaft=False))
pel.append('</g>')
# long spread primary feathers
for i in range(7):
    pel.append(feather(610 + i * 2, 276 - i * 2, 196 + i * 8.2,
                       184 - i * 4, 36 - i * 1.2,
                       ["#2c2119", "#34261c", "#271d16"][i % 3],
                       edge="#c9ad82", sw=1.6))
# scapulars at the shoulder
for i in range(3):
    pel.append(feather(708 + i * 18, 358 + i * 4, 215 + i * 2, 56, 30,
                       "#4a382b", edge="#cbb08a", sw=1.3, shaft=False))
# wing leading edge highlight
pel.append('<path d="M 750 352 C 728 322 704 296 678 278 C 656 264 632 256 610 258" '
           'fill="none" stroke="#e1c69b" stroke-width="2.2" opacity="0.55"/>')

# head, bill and pouch
pel.append('<g id="head-group">')
# long crest feathers behind the head
for i in range(3):
    pel.append(feather(812 + i * 7, 184 + i * 9, 197 + i * 9, 74 - i * 6, 17,
                       "#8a482b" if i % 2 == 0 else "#74371f",
                       edge="#e2c79a", sw=1.2))
# shaggy breeding crest (behind the head)
pel.append('<path d="M 824 250 C 812 240 802 226 796 212 L 788 186 L 802 200 L 806 174 '
           'L 816 196 L 826 170 L 832 194 L 844 178 L 840 204 L 854 198 L 844 222 L 852 236 Z" '
           'fill="#8a482b" stroke="#5a2f1c" stroke-width="1.6" stroke-linejoin="round"/>')
pel.append('<path d="M 814 226 C 806 216 800 204 796 194" fill="none" stroke="#d7b98b" '
           'stroke-width="1.4" opacity="0.5"/>')

# head
pel.append('<g clip-path="url(#neckClip)">')
pel.append(f'<path d="{HEAD_PATCH}" fill="url(#headGrad)"/>')
pel.append('<path d="M 802 254 C 794 222 804 196 830 184 C 856 172 884 178 902 196 '
           'C 876 188 850 194 830 210 C 818 220 808 238 802 254 Z" fill="#fcf8e9"/>')
pel.append('<ellipse cx="892" cy="232" rx="27" ry="20" fill="#efdfa9" opacity="0.55"/>')
pel.append('<path d="M 802 254 C 794 222 804 196 830 184 C 824 210 824 240 836 268 '
           'C 820 264 808 260 802 254 Z" fill="#8a482b" opacity="0.5"/>')
pel.append('<g fill="none" stroke="#cbb681" stroke-width="1.2" opacity="0.55" stroke-linecap="round">'
           '<path d="M 828 190 q 8 -6 16 -1"/><path d="M 844 184 q 8 -5 16 0"/>'
           '<path d="M 860 183 q 8 -4 15 1"/><path d="M 876 188 q 7 -3 13 2"/>'
           '<path d="M 890 198 q 6 -2 11 3"/><path d="M 820 206 q 7 -4 12 0"/></g>')
pel.append('</g>')
pel.append('<path d="M 802 254 C 794 222 804 196 830 184" fill="none" stroke="#8f7045" stroke-width="1.8" opacity="0.35"/>')
# loose crest feathers over the nape
for i in range(3):
    pel.append(feather(816 + i * 5, 228 - i * 9, 199 + i * 8, 54 - i * 5, 16 - i,
                       "#8a482b" if i % 2 == 0 else "#74371f",
                       edge="#e2c79a", sw=1.2))
# pale cheek and gape
pel.append('<ellipse cx="894" cy="236" rx="21" ry="17" fill="#f0e0a8" opacity="0.55"/>')
pel.append('<path d="M 880 246 C 892 250 904 254 916 258" fill="none" stroke="#9a6b43" stroke-width="1.8" opacity="0.55"/>')
# eye
pel.append('<g id="eye">'
           '<circle cx="870" cy="220" r="10" fill="#c56a4a" opacity="0.95"/>'
           '<circle cx="870" cy="220" r="7.8" fill="#e7eee8"/>'
           '<circle cx="870" cy="220" r="5.8" fill="#a9c3bb"/>'
           '<circle cx="870" cy="220" r="3.5" fill="#151a18"/>'
           '<circle cx="868.5" cy="218" r="1.3" fill="#ffffff" opacity="0.95"/>'
           '<path d="M 861 213 q 10 -5 19 0" fill="none" stroke="#6e4c2f" stroke-width="1.5" opacity="0.65"/>'
           '</g>')

# pouch
pel.append(f'<path d="{POUCH_D}" fill="url(#pouchGrad)" stroke="#641414" stroke-width="3"/>')
pel.append('<g clip-path="url(#pouchClip)">')
pel.append('<path d="M 890 286 C 896 320 912 356 936 384 C 960 410 988 418 1016 414 '
           'C 984 380 952 330 922 232 C 908 238 898 250 892 264 '
           'C 888 272 888 280 890 286 Z" fill="#681316" opacity="0.55"/>')
pel.append('<g fill="none" stroke="#701719" stroke-width="2" opacity="0.42" stroke-linecap="round">'
           '<path d="M 918 270 C 930 310 950 356 974 392"/>'
           '<path d="M 956 276 C 972 318 994 360 1018 392"/>'
           '<path d="M 1002 280 C 1018 318 1038 352 1060 378"/>'
           '<path d="M 1050 282 C 1064 310 1078 334 1092 352"/>'
           '<path d="M 1098 278 C 1112 300 1124 320 1134 338"/></g>')
pel.append('<path d="M 916 294 C 938 328 964 364 994 392 C 966 366 942 330 926 298 Z" '
           'fill="#e07a5c" opacity="0.4"/>')
pel.append('<ellipse cx="1050" cy="320" rx="28" ry="11" fill="#d05c46" opacity="0.24" transform="rotate(28 1050 320)"/>')
pel.append('</g>')
# lower mandible rim
pel.append('<path d="M 922 232 C 1000 242 1080 250 1152 258" fill="none" stroke="#8b8e76" stroke-width="10" stroke-linecap="round"/>')
pel.append('<path d="M 922 232 C 1000 242 1080 250 1152 258" fill="none" stroke="#4c5041" stroke-width="2" stroke-linecap="round" opacity="0.8"/>')
pel.append('<path d="M 926 228 C 1002 238 1080 246 1151 254" fill="none" stroke="#c9cbb0" stroke-width="1.6" opacity="0.65"/>')

# upper bill
pel.append('<path d="M 922 200 C 1000 204 1082 218 1160 236 L 1154 258 '
           'C 1082 250 1000 242 920 232 C 910 222 910 210 922 200 Z" '
           'fill="url(#billGrad)" stroke="#4e5243" stroke-width="2.2"/>')
pel.append('<path d="M 930 205 C 1004 210 1084 224 1154 240" fill="none" stroke="#c6c9ad" stroke-width="2.4" opacity="0.65"/>')
pel.append('<path d="M 960 216 q 9 2 15 5" fill="none" stroke="#4b4f41" stroke-width="2.2" stroke-linecap="round" opacity="0.8"/>')
# hooked nail
pel.append('<path d="M 1154 234 C 1168 235 1176 242 1174 250 C 1172 258 1162 262 1157 255 '
           'C 1154 250 1151 242 1146 238 Z" fill="#cb6b3f" stroke="#8a3f24" stroke-width="1.6"/>')
pel.append('<path d="M 1158 238 C 1167 241 1170 247 1168 252" fill="none" stroke="#efa77a" stroke-width="1.4" opacity="0.7"/>')
pel.append('<path d="M 1114 232 C 1134 235 1146 239 1156 243" fill="none" stroke="#b96a4d" stroke-width="3" opacity="0.35"/>')
pel.append('</g>')

# ---------------------------------------------------------------- foreground flora
flora = []
def poppy(cx, cy, s, rot=0, color="#e8873c"):
    petals = []
    for i in range(4):
        a = rot + i * 90
        petals.append(f'<ellipse cx="0" cy="-8" rx="9" ry="13" fill="{color}" '
                      f'transform="rotate({a})"/>')
    return (f'<g transform="translate({cx} {cy}) scale({s})">'
            + "".join(petals) +
            '<circle cx="0" cy="0" r="4.2" fill="#8c4b22"/>'
            '<circle cx="0" cy="0" r="2" fill="#f2c14e"/></g>')

flora.append('<g opacity="0.95">')
flora.append('<g fill="none" stroke="#5d7a45" stroke-linecap="round">'
             '<path d="M 115 964 C 118 936 118 916 126 892" stroke-width="3.4"/>'
             '<path d="M 146 970 C 150 946 154 927 166 906" stroke-width="3"/>'
             '<path d="M 96 976 C 96 954 90 934 78 920" stroke-width="3"/>'
             '<path d="M 1350 968 C 1346 942 1346 920 1338 898" stroke-width="3.2"/>'
             '<path d="M 1392 976 C 1394 952 1402 934 1412 916" stroke-width="3"/>'
             '</g>')
flora.append('<g fill="#6d8b4d" opacity="0.9">'
             '<path d="M 118 942 C 108 936 100 940 98 948 C 108 950 114 948 118 942 Z"/>'
             '<path d="M 146 946 C 156 938 166 940 170 948 C 160 952 152 950 146 946 Z"/>'
             '<path d="M 1348 948 C 1338 940 1328 942 1324 950 C 1334 954 1342 952 1348 948 Z"/>'
             '</g>')
flora.append(poppy(126, 887, 1.15, 12))
flora.append(poppy(166, 901, 0.9, 40, "#e99a4b"))
flora.append(poppy(76, 914, 0.75, 20, "#e07c35"))
flora.append(poppy(1336, 893, 1.1, 28))
flora.append(poppy(1414, 911, 0.85, 5, "#e99a4b"))
flora.append(poppy(1390, 948, 0.65, 55, "#e07c35"))
flora.append('<g fill="none" stroke="#8a9a62" stroke-width="2" stroke-linecap="round" opacity="0.85">'
             '<path d="M 108 982 C 102 962 96 950 86 942"/><path d="M 112 982 C 116 960 120 948 130 938"/>'
             '<path d="M 1360 986 C 1354 966 1348 952 1338 944"/><path d="M 1366 986 C 1370 966 1376 952 1386 944"/>'
             '</g>')
flora.append('</g>')

# ---------------------------------------------------------------- defs
defs = f'''<defs>
  <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#a9cfda"/>
    <stop offset="0.42" stop-color="#cfe2da"/>
    <stop offset="0.76" stop-color="#f3e1bb"/>
    <stop offset="1" stop-color="#f9ecd1"/>
  </linearGradient>
  <radialGradient id="sunGlow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#ffe9b6" stop-opacity="0.9"/>
    <stop offset="0.42" stop-color="#ffe9b6" stop-opacity="0.38"/>
    <stop offset="1" stop-color="#ffe9b6" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="seaGrad" x1="0" y1="742" x2="0" y2="840" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#8fb5b1"/>
    <stop offset="0.5" stop-color="#7fa8a5"/>
    <stop offset="1" stop-color="#bbd0c2"/>
  </linearGradient>
  <linearGradient id="sandGrad" x1="0" y1="830" x2="0" y2="1000" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#efdfbb"/>
    <stop offset="0.48" stop-color="#e8d1a3"/>
    <stop offset="1" stop-color="#ddc292"/>
  </linearGradient>
  <linearGradient id="rimGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f0f5f6"/>
    <stop offset="0.45" stop-color="#c0c9cf"/>
    <stop offset="1" stop-color="#8b979e"/>
  </linearGradient>
  <radialGradient id="hubGrad" cx="0.35" cy="0.3" r="0.8">
    <stop offset="0" stop-color="#f2f6f7"/>
    <stop offset="0.6" stop-color="#b3bdc3"/>
    <stop offset="1" stop-color="#6c777d"/>
  </radialGradient>
  <linearGradient id="frameGrad" x1="0" y1="470" x2="0" y2="770" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#3d9188"/>
    <stop offset="0.5" stop-color="#186a64"/>
    <stop offset="1" stop-color="#0d4a46"/>
  </linearGradient>
  <radialGradient id="ringGrad" cx="0.4" cy="0.35" r="0.9">
    <stop offset="0" stop-color="#eef3f4"/>
    <stop offset="0.55" stop-color="#b2bdc2"/>
    <stop offset="1" stop-color="#657177"/>
  </radialGradient>
  <linearGradient id="saddleGrad" x1="500" y1="484" x2="630" y2="514" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#a36a3f"/>
    <stop offset="0.55" stop-color="#7c4a29"/>
    <stop offset="1" stop-color="#4c2a16"/>
  </linearGradient>
  <linearGradient id="bodyGrad" x1="600" y1="330" x2="720" y2="520" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#725841"/>
    <stop offset="0.5" stop-color="#5f4835"/>
    <stop offset="1" stop-color="#493628"/>
  </linearGradient>
  <linearGradient id="wingGrad" x1="760" y1="350" x2="600" y2="500" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#403022"/>
    <stop offset="1" stop-color="#33261c"/>
  </linearGradient>
  <linearGradient id="neckGrad" x1="780" y1="210" x2="860" y2="410" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#b05a32"/>
    <stop offset="0.5" stop-color="#984828"/>
    <stop offset="1" stop-color="#7c3820"/>
  </linearGradient>
  <linearGradient id="headGrad" x1="820" y1="145" x2="900" y2="260" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#fdf8e8"/>
    <stop offset="0.55" stop-color="#f4e9c4"/>
    <stop offset="1" stop-color="#e8d59e"/>
  </linearGradient>
  <radialGradient id="pouchGrad" cx="990" cy="300" r="190" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#c44c37"/>
    <stop offset="0.45" stop-color="#ae352a"/>
    <stop offset="0.8" stop-color="#8a2320"/>
    <stop offset="1" stop-color="#6e1818"/>
  </radialGradient>
  <linearGradient id="billGrad" x1="900" y1="190" x2="1120" y2="250" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#a6a98f"/>
    <stop offset="0.55" stop-color="#888c73"/>
    <stop offset="1" stop-color="#6f7460"/>
  </linearGradient>
  <linearGradient id="thighGrad" x1="700" y1="470" x2="790" y2="630" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#7d6045"/>
    <stop offset="0.55" stop-color="#654b34"/>
    <stop offset="1" stop-color="#4c3727"/>
  </linearGradient>
  <linearGradient id="legGrad" x1="748" y1="600" x2="776" y2="750" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#4c4640"/>
    <stop offset="0.5" stop-color="#35312d"/>
    <stop offset="1" stop-color="#211e1b"/>
  </linearGradient>
  <linearGradient id="footGrad" x1="740" y1="675" x2="780" y2="725" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#4e4941"/>
    <stop offset="1" stop-color="#302c27"/>
  </linearGradient>
  <clipPath id="bodyClip"><path d="{BODY_D}"/></clipPath>
  <clipPath id="wingClip"><path d="{WING_D}"/></clipPath>
  <clipPath id="headClip"><path d="{HEAD_D}"/></clipPath>
  <clipPath id="pouchClip"><path d="{POUCH_D}"/></clipPath>
  <clipPath id="thighClip"><path d="M 700 505 C 748 498 788 540 802 582 C 810 602 806 616 794 620 C 774 626 752 612 742 592 C 728 562 710 532 696 518 C 690 510 694 506 700 505 Z"/></clipPath>
  <filter id="blur12" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter>
  <filter id="blur8" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>
  <filter id="blur6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
</defs>'''

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
       f'viewBox="0 0 {W} {H}" role="img" aria-labelledby="title desc">\n'
       f'<title id="title">California brown pelican riding a bicycle</title>\n'
       f'<desc id="desc">A California brown pelican in full breeding plumage with a chestnut neck, '
       f'pale yellow head, red gular pouch, dark brown feathering and a yellow foreneck patch, '
       f'pedaling a teal vintage bicycle with spoked wheels along a California beach at sunrise.</desc>\n'
       + defs + "\n"
       + '<g id="background">' + "".join(bg) + '</g>\n'
       + '<g id="shadows">' + "".join(shadows) + '</g>\n'
       + '<g id="bicycle">' + "".join(bike) + '</g>\n'
       + '<g id="rider-leg">' + "".join(leg) + '</g>\n'
       + '<g id="pelican">' + "".join(pel) + '</g>\n'
       + '<g id="foreground">' + "".join(flora) + '</g>\n'
       + '</svg>\n')

OUT.write_text(svg, encoding="utf-8")
print(f"wrote {OUT} ({len(svg)} bytes)")

