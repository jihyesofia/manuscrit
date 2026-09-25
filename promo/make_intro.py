"""30초 자기소개 영상 생성기 — Jihye Sofia Seo × Manuscrit

모든 영상 소스(비, 잉크 서명, 원고 카드, UI 목업)는 코드로 직접 그리고,
배경음악은 numpy로 즉석 작곡·합성합니다 (D major, 96 BPM, 12마디 = 30초).
폰트: Nanum Myeongjo / Gowun Batang / Cormorant Garamond (모두 SIL OFL, Google Fonts).

사용법:
    pip install numpy scipy pillow imageio-ffmpeg
    python promo/make_intro.py            # → promo/intro-30s.mp4
"""
import math
import os
import random
import subprocess
import sys
import urllib.request
import wave

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy.signal import fftconvolve, lfilter

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(HERE, ".fonts")
OUT = os.path.join(HERE, "intro-30s.mp4")
W, H, FPS, DUR = 1920, 1080, 30, 30.0
NFRAMES = int(FPS * DUR)
SR = 44100
BPM = 96
BEAT = 60 / BPM          # 0.625s
BAR = BEAT * 4           # 2.5s

random.seed(7)
np.random.seed(7)

# ─────────────────────────── palette (Manuscrit icon) ───────────────────────────
BG = (26, 23, 20)
CREAM = (226, 213, 192)
GOLD = (201, 168, 124)
MUTED = (122, 110, 92)
PAPER = (38, 34, 30)
STATUS = {"draft": ("초고", (232, 152, 48)), "revision": ("퇴고", (212, 85, 85)), "complete": ("완성", (74, 190, 106))}

# ─────────────────────────── fonts ───────────────────────────
GF = "https://raw.githubusercontent.com/google/fonts/main/ofl/"
FONT_SRC = {
    "myeongjo.ttf": GF + "nanummyeongjo/NanumMyeongjo-Regular.ttf",
    "myeongjo-b.ttf": GF + "nanummyeongjo/NanumMyeongjo-ExtraBold.ttf",
    "gowun.ttf": GF + "gowunbatang/GowunBatang-Regular.ttf",
    "cormorant.ttf": GF + "cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf",
    "cormorant-i.ttf": GF + "cormorantgaramond/CormorantGaramond-Italic%5Bwght%5D.ttf",
}
os.makedirs(FONT_DIR, exist_ok=True)
for name, url in FONT_SRC.items():
    p = os.path.join(FONT_DIR, name)
    if not os.path.exists(p):
        print("downloading", name)
        urllib.request.urlretrieve(url, p)

_font_cache = {}


def font(name, size):
    key = (name, size)
    if key not in _font_cache:
        path = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf" if name == "mono" else os.path.join(FONT_DIR, name)
        _font_cache[key] = ImageFont.truetype(path, size)
    return _font_cache[key]


# ─────────────────────────── easing / timing helpers ───────────────────────────
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


def ease_out(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3


def window(t, t0, t1, fin=0.5, fout=0.5):
    """0→1 fade in from t0, 1→0 fade out ending at t1."""
    return ease((t - t0) / fin) * (1 - ease((t - (t1 - fout)) / fout))


# ─────────────────────────── text rendering ───────────────────────────
_text_cache = {}


def is_hangul(c):
    return "가" <= c <= "힣" or "㄰" <= c <= "㆏" or c in "—→·…"


def text_img(s, fnt, fill, tracking=0, mixed_mono=False):
    """Render text to a tight RGBA image. mixed_mono: code font with hangul fallback."""
    key = (s, id(fnt), fill, tracking, mixed_mono)
    if key in _text_cache:
        return _text_cache[key]
    if mixed_mono:
        runs, cur, cur_h = [], "", None
        for c in s:
            h = is_hangul(c)
            if cur and h != cur_h:
                runs.append((cur, cur_h))
                cur = ""
            cur += c
            cur_h = h
        if cur:
            runs.append((cur, cur_h))
        kfont = font("gowun.ttf", fnt.size)
        pieces = [(r, kfont if h else fnt) for r, h in runs]
    elif tracking:
        pieces = [(c, fnt) for c in s]
    else:
        pieces = [(s, fnt)]
    asc = max(f.getmetrics()[0] for _, f in pieces) if pieces else fnt.getmetrics()[0]
    desc = max(f.getmetrics()[1] for _, f in pieces) if pieces else fnt.getmetrics()[1]
    widths = [f.getlength(p) + (tracking if tracking and not mixed_mono else 0) for p, f in pieces]
    w = int(sum(widths)) + 8
    img = Image.new("RGBA", (max(w, 1), asc + desc + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x = 4
    for (p, f), pw in zip(pieces, widths):
        a = f.getmetrics()[0]
        d.text((x, 4 + asc - a), p, font=f, fill=fill)
        x += pw
    _text_cache[key] = img
    return img


def with_alpha(img, a):
    if a >= 0.999:
        return img
    out = img.copy()
    out.putalpha(img.getchannel("A").point([int(v * a) for v in range(256)]))
    return out


def put(frame, img, x, y, a=1.0, anchor="c", scale=1.0):
    """Composite img onto frame. anchor: c=center, l=left-middle, r=right-middle."""
    if a <= 0.003:
        return
    if scale != 1.0:
        img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
    if anchor == "c":
        px, py = x - img.width // 2, y - img.height // 2
    elif anchor == "l":
        px, py = x, y - img.height // 2
    else:
        px, py = x - img.width, y - img.height // 2
    frame.alpha_composite(with_alpha(img, a), (int(px), int(py)))


def typed(s, t, t0, t1):
    """Return the visible prefix of s for a typewriter running t0→t1."""
    n = len(s)
    k = int(clamp((t - t0) / (t1 - t0)) * n + 1e-6)
    return s[:k], k


def char_times(s, t0, t1):
    n = len(s)
    return [t0 + (i + 1) / n * (t1 - t0) for i, c in enumerate(s) if c != " "]


# ─────────────────────────── background ───────────────────────────
def make_base():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.sqrt(((xx - W / 2) / (W * 0.62)) ** 2 + ((yy - H / 2) / (H * 0.62)) ** 2)
    vign = np.clip(1.15 - 0.55 * r ** 1.6, 0.35, 1.1)
    glow = np.exp(-(((xx - W * 0.5) / (W * 0.45)) ** 2 + ((yy - H * 0.42) / (H * 0.5)) ** 2)) * 10
    base = np.zeros((H, W, 3), np.float32)
    for i, c in enumerate(BG):
        base[..., i] = c * vign + glow * (1.0 if i == 0 else 0.85 if i == 1 else 0.65)
    return base


BASE = make_base()
GRAIN = [(np.random.randn(H // 2, W // 2) * 2.2).astype(np.float32) for _ in range(6)]
GRAIN = [np.kron(g, np.ones((2, 2), np.float32))[..., None] for g in GRAIN]


# ─────────────────────────── rain ───────────────────────────
DROPS = [
    dict(x=random.uniform(-200, W + 200), y=random.uniform(-H, H), z=random.uniform(0.3, 1.0))
    for _ in range(260)
]


def draw_rain(frame, t, a):
    if a <= 0:
        return
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for dr in DROPS:
        z = dr["z"]
        speed = 1400 * z + 500
        y = (dr["y"] + t * speed) % (H + 300) - 150
        x = dr["x"] - (y * 0.12)
        ln = 30 + 60 * z
        col = (170, 180, 195, int(a * (40 + 90 * z)))
        d.line([(x, y), (x - ln * 0.12, y + ln)], fill=col, width=1 if z < 0.7 else 2)
    frame.alpha_composite(layer)


# ─────────────────────────── ink signature (icon.svg paths) ───────────────────────────
def cubic(p0, p1, p2, p3, n=40):
    return [
        (
            (1 - u) ** 3 * p0[0] + 3 * (1 - u) ** 2 * u * p1[0] + 3 * (1 - u) * u * u * p2[0] + u ** 3 * p3[0],
            (1 - u) ** 3 * p0[1] + 3 * (1 - u) ** 2 * u * p1[1] + 3 * (1 - u) * u * u * p2[1] + u ** 3 * p3[1],
        )
        for u in np.linspace(0, 1, n)
    ]


SIG_SEGS = [
    [(115, 390), (115, 350), (125, 280), (140, 240)], [(140, 240), (150, 215), (165, 195), (185, 190)],
    [(185, 190), (210, 183), (225, 200), (230, 225)], [(230, 225), (235, 255), (228, 310), (222, 360)],
    [(222, 360), (220, 375), (218, 385), (216, 392)],
    [(216, 392), (218, 365), (225, 280), (235, 240)], [(235, 240), (242, 215), (255, 195), (275, 190)],
    [(275, 190), (298, 183), (312, 200), (317, 230)], [(317, 230), (322, 260), (315, 320), (308, 370)],
    [(308, 370), (305, 385), (302, 392), (300, 398)],
    [(300, 398), (305, 370), (318, 290), (335, 250)], [(335, 250), (348, 220), (362, 205), (378, 200)],
    [(378, 200), (390, 197), (398, 205), (402, 218)],
]
SIG_PTS = []
for seg in SIG_SEGS:
    SIG_PTS += cubic(*seg)


def draw_signature(frame, progress, cx, cy, size, a=1.0, nib=0.0):
    if a <= 0:
        return
    s = size / 512
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    n = int(len(SIG_PTS) * clamp(progress))
    pts = [(cx + (x - 256) * s, cy + (y - 290) * s) for x, y in SIG_PTS[:n]]
    wid = max(2, int(10 * s))
    if len(pts) > 1:
        d.line(pts, fill=CREAM + (int(255 * a),), width=wid, joint="curve")
        for p in (pts[0], pts[-1]):
            d.ellipse([p[0] - wid / 2, p[1] - wid / 2, p[0] + wid / 2, p[1] + wid / 2], fill=CREAM + (int(255 * a),))
    if nib > 0:
        tri = [(402, 218), (420, 195), (426, 208)]
        d.polygon([(cx + (x - 256) * s, cy + (y - 290) * s) for x, y in tri], fill=GOLD + (int(255 * a * nib),))
        for (x, y, r, o) in [(432, 198, 4, 0.5), (440, 190, 2.5, 0.3)]:
            X, Y, R = cx + (x - 256) * s, cy + (y - 290) * s, r * s
            d.ellipse([X - R, Y - R, X + R, Y + R], fill=GOLD + (int(255 * a * nib * o),))
    if progress < 1 and n > 0:  # glowing pen tip
        gx, gy = pts[-1] if pts else (cx, cy)
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse([gx - 14, gy - 14, gx + 14, gy + 14], fill=GOLD + (int(160 * a),))
        layer.alpha_composite(glow.filter(ImageFilter.GaussianBlur(8)))
    frame.alpha_composite(layer)


# ─────────────────────────── shapes ───────────────────────────
def rrect(frame, box, r, fill, a=1.0, outline=None, width=1):
    if a <= 0.003:
        return
    x0, y0, x1, y1 = [int(v) for v in box]
    layer = Image.new("RGBA", (x1 - x0 + 4, y1 - y0 + 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([1, 1, x1 - x0 + 1, y1 - y0 + 1], r,
                        fill=fill[:3] + (int((fill[3] if len(fill) > 3 else 255) * a),) if fill else None,
                        outline=outline[:3] + (int((outline[3] if len(outline) > 3 else 255) * a),) if outline else None,
                        width=width)
    frame.alpha_composite(layer, (x0 - 1, y0 - 1))


def dot(frame, x, y, r, col, a=1.0):
    rrect(frame, (x - r, y - r, x + r, y + r), r, col, a)


# ─────────────────────────── scene content ───────────────────────────
MEMO = "비 오는 서울, 을지로 골목."
HELLO = "안녕하세요."
INTRO = "이야기를 쓰는 사람, 지혜입니다."
PROSE = "5년 만이었다. 비는 그날처럼 골목을 적시고 있었다."

WORKS = [
    ("남자 사이에 우정은 없어", "우정과 사랑 사이,|그 경계에서 흔들리는 이야기", [(0, "draft"), (13.75, "revision")]),
    ("프래질 프랙탈", "부서지기 쉬운 것들이|만들어내는 무한한 패턴", [(0, "draft")]),
    ("오프 밸런스", "균형을 잃은 두 사람이|서로에게 기대어 서는 법", [(0, "draft"), (13.125, "revision"), (15.0, "complete")]),
]

CODE = [
    "const STATUS_CONFIG = {",
    '  draft:    { label: "초고", color: "#e89830" },',
    '  revision: { label: "퇴고", color: "#d45555" },',
    '  complete: { label: "완성", color: "#4abe6a" },',
    "};",
    "const AUTOSAVE_DELAY = 2000;",
    "const nextStatus = (s) =>",
    "  STATUS_ORDER[(STATUS_ORDER.indexOf(s) + 1) % 3];",
    "",
    "export default function Manuscrit() {",
    '  const isDesktop = useMediaQuery("(min-width: 768px)");',
    "  const [projects, setProjects] = useState(load);",
    "  // Google Drive · Firebase 실시간 동기화",
    "  useEffect(() => syncToCloud(projects), [projects]);",
]

T_MEMO = (0.5, 1.9)
T_HELLO = (5.5, 6.2)
T_INTRO = (6.6, 8.4)
T_PROSE = (21.6, 23.9)


def status_at(seq, t):
    cur, since = seq[0][1], -99
    for ts, st in seq:
        if t >= ts:
            cur, since = st, ts
    return cur, since


def scene(frame, t):
    # ── S1: rain + memo line ──────────────────────────────
    draw_rain(frame, t, 1 - ease((t - 5.0) / 2.0))
    a = window(t, 0.2, 2.9, 0.4, 0.5)
    if a > 0:
        put(frame, text_img("memo —", font("cormorant-i.ttf", 34), MUTED), W // 2, 470, a)
        s, _ = typed(MEMO, t, *T_MEMO)
        put(frame, text_img(s or " ", font("gowun.ttf", 50), GOLD), W // 2 - text_img(MEMO, font("gowun.ttf", 50), GOLD).width // 2, 545, a, "l")

    # ── S1b: ink signature + name ─────────────────────────
    a = window(t, 2.6, 5.4, 0.3, 0.6)
    if a > 0:
        rise = ease((t - 4.8) / 0.6) * 30
        draw_signature(frame, ease((t - 2.7) / 1.5), W // 2, 420 - rise, 420, a, nib=ease((t - 4.0) / 0.4))
        na = ease((t - 3.9) / 0.7)
        put(frame, text_img("Jihye Sofia Seo", font("cormorant.ttf", 76), CREAM, tracking=6), W // 2, 740 - rise + (1 - na) * 18, a * na)

    # ── S2: greeting ──────────────────────────────────────
    a = window(t, 5.3, 10.3, 0.2, 0.6)
    if a > 0:
        s, _ = typed(HELLO, t, *T_HELLO)
        put(frame, text_img(s or " ", font("myeongjo.ttf", 64), MUTED), 330, 420, a, "l")
        s2, k2 = typed(INTRO, t, *T_INTRO)
        img2 = text_img(s2 or " ", font("myeongjo-b.ttf", 92), CREAM)
        put(frame, img2, 330, 540, a, "l")
        # blinking cursor
        cur_x = 330 + (img2.width if s2 else 0) + 8
        cur_y = 540 if t > T_INTRO[0] - 0.2 else 420
        if t < T_INTRO[0] - 0.2:
            cur_x = 330 + text_img(s or " ", font("myeongjo.ttf", 64), MUTED).width + 8
        if (int(t * 2.4) % 2 == 0) or (T_HELLO[0] < t < T_HELLO[1]) or (T_INTRO[0] < t < T_INTRO[1]):
            rrect(frame, (cur_x, cur_y - 44, cur_x + 5, cur_y + 44), 2, GOLD + (220,), a)
        sa = ease((t - 8.6) / 0.6)
        put(frame, text_img("WEB NOVELIST", font("cormorant.ttf", 40), GOLD, tracking=10), 334, 670, a * sa, "l")
        put(frame, text_img("·  웹소설 작가", font("gowun.ttf", 36), MUTED), 334 + text_img("WEB NOVELIST", font("cormorant.ttf", 40), GOLD, tracking=10).width + 18, 672, a * sa, "l")
        rrect(frame, (334, 612, 334 + int(560 * ease((t - 8.4) / 0.8)), 614), 1, GOLD + (120,), a)

    # ── S3: works + status cycling ────────────────────────
    a = window(t, 10.1, 17.6, 0.4, 0.6)
    if a > 0:
        put(frame, text_img("지금 쓰고 있는 이야기들", font("gowun.ttf", 40), MUTED), W // 2, 190, a * ease((t - 10.2) / 0.5))
        cw, ch, gap = 500, 380, 50
        x0 = (W - (3 * cw + 2 * gap)) // 2
        for i, (title, syn, seq) in enumerate(WORKS):
            ca = ease_out((t - (10.5 + i * 0.4)) / 0.7)
            if ca <= 0:
                continue
            cx = x0 + i * (cw + gap)
            cy = 290 + (1 - ca) * 60
            rrect(frame, (cx, cy, cx + cw, cy + ch), 18, PAPER + (235,), a * ca, outline=MUTED + (90,), width=2)
            put(frame, text_img(f"0{i + 1}", font("cormorant-i.ttf", 44), GOLD), cx + 40, cy + 60, a * ca, "l")
            timg = text_img(title, font("myeongjo-b.ttf", 40 if len(title) > 8 else 50), CREAM)
            put(frame, timg, cx + 40, cy + 150, a * ca, "l")
            # synopsis, two lines
            for j, line in enumerate(syn.split("|")):
                put(frame, text_img(line, font("gowun.ttf", 27), MUTED), cx + 40, cy + 220 + j * 40, a * ca, "l")
            st, since = status_at(seq, t)
            label, col = STATUS[st]
            pop = 1 + 0.25 * math.exp(-max(0, t - since) * 6) if since > 0 else 1
            px, py = cx + 40, cy + ch - 58
            dot(frame, px + 10, py, 10 * pop, col + (255,), a * ca)
            put(frame, text_img(label, font("gowun.ttf", 30), col), px + 32, py, a * ca, "l")
        ba = ease((t - 12.6) / 0.6)
        if ba > 0:
            xs = W // 2 - 330
            for j, key in enumerate(["draft", "revision", "complete"]):
                label, col = STATUS[key]
                ja = ease((t - (12.6 + j * 0.625)) / 0.4)
                put(frame, text_img(label, font("myeongjo-b.ttf", 54), col), xs + j * 280, 820, a * ja)
                if j < 2:
                    put(frame, text_img("→", font("gowun.ttf", 44), MUTED), xs + j * 280 + 140, 820, a * ja)
            put(frame, text_img("한 화, 한 화. 초고에서 완성까지.", font("gowun.ttf", 34), CREAM), W // 2, 905, a * ease((t - 14.6) / 0.6))

    # ── S4: code → app ────────────────────────────────────
    a = window(t, 17.5, 25.1, 0.4, 0.6)
    if a > 0:
        put(frame, text_img("쓰는 도구는, 직접 만듭니다.", font("myeongjo-b.ttf", 62), CREAM), W // 2, 150, a * ease((t - 17.6) / 0.6))
        # code panel
        ca = ease((t - 18.0) / 0.5) * (1 - ease((t - 20.4) / 0.6))
        if ca > 0:
            bx, by, bw, bh = 360, 250, 1200, 620
            rrect(frame, (bx, by, bx + bw, by + bh), 16, (20, 18, 16, 245), a * ca, outline=MUTED + (80,), width=2)
            for k, c in enumerate([(212, 85, 85), (232, 152, 48), (74, 190, 106)]):
                dot(frame, bx + 34 + k * 30, by + 32, 8, c + (255,), a * ca)
            put(frame, text_img("src/App.jsx", font("mono", 22), MUTED), bx + bw // 2, by + 32, a * ca)
            nshow = int(clamp((t - 18.2) / 1.9) * len(CODE)) + 1
            for k, line in enumerate(CODE[:nshow]):
                col = GOLD if line.strip().startswith(("const", "export")) else (150, 160, 150) if "//" in line else CREAM
                put(frame, text_img(line or " ", font("mono", 26), col, mixed_mono=True), bx + 50, by + 90 + k * 37, a * ca, "l")
        # app mockup
        ma = ease_out((t - 20.5) / 0.8)
        if ma > 0:
            sc = 0.92 + 0.08 * ma
            mw, mh = int(1400 * sc), int(700 * sc)
            mx, my = (W - mw) // 2, 250 + int((1 - ma) * 40)
            aa = a * ma
            rrect(frame, (mx, my, mx + mw, my + mh), 18, (30, 27, 24, 250), aa, outline=MUTED + (110,), width=2)
            rrect(frame, (mx, my, mx + mw, my + 56), 18, (40, 36, 32, 255), aa)
            put(frame, text_img("Manuscrit", font("cormorant.ttf", 34), CREAM, tracking=3), mx + 30, my + 28, aa, "l")
            lw, rw = int(mw * 0.26), int(mw * 0.24)
            # left: project tree
            rrect(frame, (mx + lw, my + 56, mx + lw + 2, my + mh), 0, MUTED + (80,), aa)
            rrect(frame, (mx + mw - rw, my + 56, mx + mw - rw + 2, my + mh), 0, MUTED + (80,), aa)
            ty = my + 100
            tree = [("남자 사이에 우정은 없어", None, CREAM), ("   1화: 재회", "revision", GOLD), ("   2화: 균열", "draft", MUTED),
                    ("프래질 프랙탈", None, CREAM), ("오프 밸런스", None, CREAM), ("   1화: 인수", "complete", MUTED),
                    ("   2화: 실사", "revision", MUTED), ("   3화: 합병", "draft", MUTED)]
            for k, (lab, st, col) in enumerate(tree):
                ia = ease((t - (20.9 + k * 0.08)) / 0.3)
                yy = ty + k * 52
                if k == 1:
                    rrect(frame, (mx + 12, yy - 22, mx + lw - 12, yy + 22), 8, GOLD + (40,), aa * ia)
                put(frame, text_img(lab, font("gowun.ttf", 25), col), mx + 26, yy, aa * ia, "l")
                if st:
                    dot(frame, mx + lw - 36, yy, 7, STATUS[st][1] + (255,), aa * ia)
            # editor
            ex = mx + lw + 60
            put(frame, text_img("1화: 재회", font("myeongjo-b.ttf", 44), CREAM), ex, my + 120, aa, "l")
            rrect(frame, (ex, my + 160, ex + 200, my + 162), 1, GOLD + (140,), aa)
            s, _ = typed(PROSE, t, *T_PROSE)
            # wrap prose into lines of ~ 17 chars
            lines, cur = [], ""
            for word in s.split(" "):
                if len(cur) + len(word) > 16 and cur:
                    lines.append(cur)
                    cur = word
                else:
                    cur = (cur + " " + word).strip()
            lines.append(cur)
            for k, ln in enumerate(lines):
                put(frame, text_img(ln or " ", font("gowun.ttf", 36), CREAM), ex, my + 225 + k * 62, aa, "l")
            if int(t * 2.4) % 2 == 0 or T_PROSE[0] < t < T_PROSE[1]:
                lx = ex + text_img(lines[-1] or " ", font("gowun.ttf", 36), CREAM).width + 4
                ly = my + 225 + (len(lines) - 1) * 62
                rrect(frame, (lx, ly - 24, lx + 3, ly + 24), 1, GOLD + (220,), aa * ease((t - 21.4) / 0.2))
            # memo
            rx = mx + mw - rw + 30
            put(frame, text_img("MEMO", font("cormorant.ttf", 26), GOLD, tracking=6), rx, my + 110, aa, "l")
            for k, ln in enumerate(["도입부 — 5년 만의", "재회 장면으로 시작", "", "분위기: 비 오는 서울,", "을지로 골목"]):
                put(frame, text_img(ln or " ", font("gowun.ttf", 25), MUTED), rx, my + 170 + k * 44, aa * ease((t - 21.2) / 0.5), "l")
        tags = "React  ·  PWA  ·  Google Drive Sync  ·  Firebase"
        put(frame, text_img(tags, font("cormorant.ttf", 36), GOLD, tracking=2), W // 2, 1005, a * ease((t - 22.3) / 0.6))

    # ── S5: closing ───────────────────────────────────────
    a = window(t, 25.0, 31.0, 0.5, 0.1)
    if a > 0:
        draw_signature(frame, 1.0, W // 2, 310, 260, a * ease((t - 25.1) / 0.6), nib=1.0)
        put(frame, text_img("Manuscrit", font("cormorant.ttf", 110), CREAM, tracking=8), W // 2, 520, a * ease((t - 25.5) / 0.7))
        put(frame, text_img("이야기를 쓰고, 도구를 짓는 사람", font("myeongjo.ttf", 52), CREAM), W // 2, 660, a * ease((t - 26.3) / 0.7))
        rrect(frame, (W // 2 - 60, 735, W // 2 + 60, 737), 1, GOLD + (160,), a * ease((t - 26.8) / 0.5))
        put(frame, text_img("Jihye Sofia Seo   ·   github.com/jihyesofia", font("cormorant.ttf", 40), GOLD, tracking=2),
            W // 2, 800, a * ease((t - 27.1) / 0.7))


def render_frame(i):
    t = i / FPS
    frame = Image.fromarray(np.uint8(np.clip(BASE, 0, 255))).convert("RGBA")
    scene(frame, t)
    arr = np.asarray(frame.convert("RGB"), dtype=np.float32)
    arr += GRAIN[i % len(GRAIN)]
    # global fade in / out
    g = ease(t / 0.6) * (1 - ease((t - 28.8) / 1.2))
    arr *= g
    return np.uint8(np.clip(arr, 0, 255))


# ─────────────────────────── music ───────────────────────────
def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


N = int(SR * DUR)
tt = np.arange(N) / SR


def env_adsr(n, a, d, s, r_len, total):
    e = np.ones(n)
    ai, di = int(a * SR), int(d * SR)
    e[:ai] = np.linspace(0, 1, ai) if ai else 1
    e[ai:ai + di] = np.linspace(1, s, len(e[ai:ai + di]))
    e[ai + di:] = s
    rel_start = int(total * SR)
    if rel_start < n:
        e[rel_start:] *= np.exp(-np.arange(n - rel_start) / (r_len * SR))
    return e


def piano(buf, start, midi, dur, vel):
    f = mtof(midi)
    ln = int(min(DUR - start, dur + 2.5) * SR)
    if ln <= 0:
        return
    x = np.arange(ln) / SR
    tone = np.zeros(ln)
    for h, amp in [(1, 1.0), (2, 0.45), (3, 0.22), (4, 0.12), (5, 0.06), (6, 0.03)]:
        fh = f * h * (1 + 0.0004 * h * h)
        tone += amp * np.sin(2 * np.pi * fh * x) * np.exp(-x * (1.2 + 0.9 * h) * (f / 440) ** 0.3)
    att = np.minimum(1, x / 0.004)
    rel = np.where(x > dur, np.exp(-(x - dur) / 0.25), 1)
    hammer = np.random.randn(ln) * np.exp(-x / 0.004) * 0.08
    s0 = int(start * SR)
    buf[s0:s0 + ln] += (tone * att * rel + hammer) * vel


def pad(buf, start, midis, dur, vel):
    ln = int(min(DUR - start, dur + 1.5) * SR)
    x = np.arange(ln) / SR
    e = env_adsr(ln, 0.8, 0.5, 0.8, 0.7, dur)
    out = np.zeros(ln)
    for m in midis:
        f = mtof(m)
        for det in (-0.12, 0.0, 0.12):
            ff = f * 2 ** (det / 12)
            out += np.sin(2 * np.pi * ff * x) + 0.3 * np.sin(4 * np.pi * ff * x) + 0.12 * np.sin(6 * np.pi * ff * x)
    out *= e * (1 + 0.15 * np.sin(2 * np.pi * 0.3 * x))
    s0 = int(start * SR)
    buf[s0:s0 + ln] += out * vel / len(midis)


def bass(buf, start, midi, dur, vel):
    ln = int(min(DUR - start, dur + 0.4) * SR)
    x = np.arange(ln) / SR
    f = mtof(midi)
    e = np.minimum(1, x / 0.01) * np.exp(-x / 1.2) * np.where(x > dur, np.exp(-(x - dur) / 0.08), 1)
    s0 = int(start * SR)
    buf[s0:s0 + ln] += (np.sin(2 * np.pi * f * x) + 0.25 * np.sin(4 * np.pi * f * x)) * e * vel


def kick(buf, start, vel):
    ln = int(0.4 * SR)
    x = np.arange(ln) / SR
    f = 45 + 90 * np.exp(-x / 0.03)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s0 = int(start * SR)
    seg = np.sin(ph) * np.exp(-x / 0.12) * vel
    buf[s0:s0 + ln] += seg[: len(buf[s0:s0 + ln])]


def hat(buf, start, vel, decay=0.03):
    ln = int(0.15 * SR)
    x = np.arange(ln) / SR
    n = np.random.randn(ln)
    n = n - lfilter([1], [1, -0.92], n) * 0.9  # crude highpass
    s0 = int(start * SR)
    seg = n * np.exp(-x / decay) * vel
    buf[s0:s0 + ln] += seg[: len(buf[s0:s0 + ln])]


def click(buf, start, vel):
    ln = int(0.05 * SR)
    x = np.arange(ln) / SR
    n = np.random.randn(ln)
    body = np.sin(2 * np.pi * 1800 * x) * 0.4 + np.sin(2 * np.pi * 3100 * x) * 0.3
    s0 = int(start * SR)
    seg = (n * 0.6 + body) * np.exp(-x / 0.006) * vel
    buf[s0:s0 + ln] += seg[: len(buf[s0:s0 + ln])]


# chord voicings (MIDI): (bass root, arpeggio notes, pad notes)
CH = {
    "Dmaj7": (38, [50, 57, 61, 64, 66, 69], [62, 66, 69, 73]),
    "Bm7": (35, [47, 54, 57, 62, 66, 69], [62, 66, 69, 71]),
    "Gmaj7": (43, [43, 50, 54, 59, 62, 66], [59, 62, 66, 67]),
    "Asus4": (45, [45, 52, 57, 62, 64, 69], [62, 64, 69]),
    "A": (45, [45, 52, 57, 61, 64, 69], [61, 64, 69]),
    "F#m7": (42, [42, 49, 52, 57, 61, 64], [61, 64, 69, 64]),
    "Em7": (40, [40, 47, 50, 55, 59, 62], [59, 62, 67, 71]),
    "A7": (45, [45, 52, 55, 61, 64, 67], [61, 64, 67]),
    "Dmaj9": (38, [50, 57, 61, 64, 66, 69], [62, 66, 69, 73, 76]),
}
# 12 bars; each entry = list of (chord, beats)
PROG = [
    [("Dmaj7", 4)], [("Bm7", 4)], [("Gmaj7", 4)], [("Asus4", 2), ("A", 2)],
    [("Dmaj7", 4)], [("F#m7", 4)], [("Gmaj7", 4)], [("A", 4)],
    [("Bm7", 4)], [("Gmaj7", 4)], [("Em7", 2), ("A7", 2)], [("Dmaj9", 4)],
]
# melody from bar 5 (index 4): (bar, beat, midi, beats)
MEL = [
    (4, 0, 78, 2), (4, 2, 76, 1), (4, 3, 74, 1),
    (5, 0, 73, 3), (5, 3, 69, 1),
    (6, 0, 71, 1), (6, 1, 74, 1), (6, 2, 78, 2),
    (7, 0, 76, 4),
    (8, 0, 78, 1), (8, 1, 81, 1), (8, 2, 78, 1), (8, 3, 76, 1),
    (9, 0, 74, 2), (9, 2, 71, 2),
    (10, 0, 76, 2), (10, 2, 73, 2),
    (11, 0, 74, 4), (11, 0, 81, 4),
]
ARP = [0, 2, 3, 4, 5, 4, 3, 2]


def compose(click_times):
    piano_b = np.zeros(N + SR * 4)
    pad_b = np.zeros(N + SR * 4)
    drum_b = np.zeros(N + SR * 4)
    fx_b = np.zeros(N + SR * 4)
    for bi, bar in enumerate(PROG):
        beat_pos = 0
        for name, beats in bar:
            root, arp, pads = CH[name]
            st = bi * BAR + beat_pos * BEAT
            if bi == 11:  # final bar: rolled chord, let ring
                for k, m in enumerate(arp):
                    piano(piano_b, st + k * 0.05, m, 2.4, 0.22)
            else:
                for e in range(beats * 2):
                    m = arp[ARP[(beat_pos * 2 + e) % 8]]
                    vel = (0.16 if e % 2 == 0 else 0.11) * (0.8 if bi < 2 else 1.0)
                    piano(piano_b, st + e * BEAT / 2, m, BEAT * 0.9, vel)
            if bi >= 2:
                pad(pad_b, st, pads, beats * BEAT, 0.07 if bi < 4 else 0.09)
            if bi >= 4:
                bass(drum_b, st, root, beats * BEAT * 0.5, 0.35)
                if beats == 4:
                    bass(drum_b, st + 2 * BEAT, root, BEAT * 1.5, 0.28)
            beat_pos += beats
    for bar, beat, m, beats in MEL:
        piano(piano_b, bar * BAR + beat * BEAT, m, beats * BEAT, 0.22)
    # soft groove bars 7–11 (index 6..10)
    for bi in range(6, 11):
        for b in range(4):
            st = bi * BAR + b * BEAT
            if b in (0, 2):
                kick(drum_b, st, 0.5 if bi >= 8 else 0.3)
            hat(drum_b, st + BEAT / 2, 0.05)
            if bi >= 8:
                hat(drum_b, st, 0.03)
            if b in (1, 3) and bi >= 8:
                hat(drum_b, st, 0.09, decay=0.08)
    # rain ambience (0–7s)
    rn = np.random.randn(int(8 * SR))
    rn = lfilter([0.08], [1, -0.92], rn) + np.random.randn(len(rn)) * 0.02
    x = np.arange(len(rn)) / SR
    fx_b[: len(rn)] += rn * np.clip(x / 0.5, 0, 1) * np.clip((7.5 - x) / 2.5, 0, 1) * 0.5
    for ct in click_times:
        click(fx_b, ct + random.uniform(-0.01, 0.01), random.uniform(0.07, 0.11))
    # reverb
    ir_len = int(2.2 * SR)
    ir = np.random.randn(ir_len) * np.exp(-np.arange(ir_len) / SR / 0.55)
    ir = lfilter([0.3], [1, -0.7], ir)
    ir /= np.abs(ir).sum() ** 0.5 * 12
    dry = piano_b + pad_b
    wet = fftconvolve(dry, ir)[: len(dry)]
    mix = dry * 0.85 + wet * 0.9 + drum_b * 0.8 + fx_b
    mix = mix[:N]
    # master fade + soft clip
    fade = np.clip((DUR - tt) / 2.0, 0, 1) ** 1.5
    mix *= fade * np.clip(tt / 0.3, 0, 1)
    mix = np.tanh(mix / np.max(np.abs(mix)) * 1.3) * 0.8
    # stereo: slight Haas widening on wet
    left = mix
    right = np.concatenate([mix[:1], mix[:-1]]) * 0.98 + mix * 0.02
    stereo = np.stack([left, right], 1)
    return np.int16(np.clip(stereo, -1, 1) * 32767)


def main():
    clicks = char_times(MEMO, *T_MEMO) + char_times(HELLO, *T_HELLO) + char_times(INTRO, *T_INTRO) + char_times(PROSE, *T_PROSE)
    wav_path = os.path.join(HERE, ".intro-audio.wav")
    audio = compose(clicks)
    with wave.open(wav_path, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(audio.tobytes())
    print("audio done")

    ff = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [ff, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-i", wav_path, "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", OUT]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    only = [int(a) for a in sys.argv[1:]]  # optional: preview frame numbers → PNG
    if only:
        proc.stdin.close()
        proc.kill()
        for i in only:
            Image.fromarray(render_frame(i)).save(os.path.join(HERE, f".preview-{i:04d}.png"))
        return
    for i in range(NFRAMES):
        proc.stdin.write(render_frame(i).tobytes())
        if i % 90 == 0:
            print(f"frame {i}/{NFRAMES}")
    proc.stdin.close()
    proc.wait()
    os.remove(wav_path)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
