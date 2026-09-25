"""솜솜철학 30초 소개 영상 — "존재에는 우열이 없다"

텍스트 중심 영상. 배경의 부드러운 솜(cotton) 입자와 문장이 번지듯 나타나는 연출은 코드로 그리고,
음악은 numpy로 즉석 작곡·합성합니다 (D minor → F, 72 BPM, 9마디 = 30초).
폰트: Nanum Myeongjo / Gowun Batang / Cormorant Garamond (SIL OFL, Google Fonts).

사용법:
    pip install numpy scipy pillow imageio-ffmpeg
    python promo/make_somsom.py           # → promo/somsom-philosophy-30s.mp4
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
OUT = os.path.join(HERE, "somsom-philosophy-30s.mp4")
W, H, FPS, DUR = 1920, 1080, 30, 30.0
NFRAMES = int(FPS * DUR)
SR = 44100
BPM = 72
BEAT = 60 / BPM          # 0.833s
BAR = BEAT * 4           # 3.333s

random.seed(11)
np.random.seed(11)

# ─────────────────────────── palette: 종이, 먹, 솜 ───────────────────────────
PAPER = (240, 234, 224)
INK = (43, 39, 36)
SOFT = (120, 110, 102)
ROSE = (164, 110, 98)
COTTON = (255, 252, 247)

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
        _font_cache[key] = ImageFont.truetype(os.path.join(FONT_DIR, name), size)
    return _font_cache[key]


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


def ease_out(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3


# ─────────────────────────── text ───────────────────────────
_text_cache = {}


def text_img(s, fnt, fill, tracking=0):
    key = (s, id(fnt), fill, tracking)
    if key in _text_cache:
        return _text_cache[key]
    asc, desc = fnt.getmetrics()
    chars = list(s) if tracking else [s]
    widths = [fnt.getlength(c) + tracking for c in chars]
    img = Image.new("RGBA", (int(sum(widths)) + 12, asc + desc + 12), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x = 6
    for c, w in zip(chars, widths):
        d.text((x, 6), c, font=fnt, fill=fill)
        x += w
    _text_cache[key] = img
    return img


def reveal(img, p, a=1.0, feather=0.35):
    """Soft left→right ink-bleed reveal. p in [0,1]."""
    if p >= 1 and a >= 0.999:
        return img
    arr = np.asarray(img).copy()
    w = arr.shape[1]
    fw = feather * w
    x = np.arange(w, dtype=np.float32)
    ramp = np.clip((p * (w + fw) - x) / fw, 0, 1) * a
    arr[..., 3] = (arr[..., 3].astype(np.float32) * ramp[None, :]).astype(np.uint8)
    return Image.fromarray(arr)


def put(frame, img, x, y, anchor="c"):
    px = x - img.width // 2 if anchor == "c" else x
    frame.alpha_composite(img, (int(px), int(y - img.height // 2)))


def line(frame, s, fnt, fill, x, y, p, a=1.0, tracking=0, anchor="c", blur_in=True):
    if a <= 0.003 or p <= 0:
        return
    img = text_img(s, fnt, fill, tracking)
    img = reveal(img, p, a)
    put(frame, img, x, y, anchor)


# ─────────────────────────── background: paper + cotton ───────────────────────────
def make_base():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.sqrt(((xx - W / 2) / (W * 0.7)) ** 2 + ((yy - H / 2) / (H * 0.7)) ** 2)
    vign = np.clip(1.03 - 0.16 * r ** 2, 0.8, 1.03)
    fiber = np.random.randn(H // 4, W // 4).astype(np.float32)
    fiber = np.asarray(Image.fromarray(np.uint8(np.clip(fiber * 30 + 128, 0, 255))).resize((W, H), Image.BICUBIC), np.float32)
    fiber = (fiber - 128) / 128 * 2.5
    base = np.zeros((H, W, 3), np.float32)
    for i, c in enumerate(PAPER):
        base[..., i] = c * vign + fiber
    return base


BASE = make_base()
GRAIN = [np.kron((np.random.randn(H // 2, W // 2) * 1.6).astype(np.float32), np.ones((2, 2), np.float32))[..., None] for _ in range(6)]


def cotton_sprite(r):
    s = int(r * 4)
    mask = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(mask)
    for _ in range(7):  # fluffy: several overlapping soft puffs
        ox, oy = random.uniform(-r * 0.45, r * 0.45), random.uniform(-r * 0.3, r * 0.3)
        rr = r * random.uniform(0.45, 0.8)
        d.ellipse([s / 2 + ox - rr, s / 2 + oy - rr, s / 2 + ox + rr, s / 2 + oy + rr], fill=215)
    img = Image.new("RGBA", (s, s), COTTON + (0,))
    img.putalpha(mask.filter(ImageFilter.GaussianBlur(r * 0.45)))  # blur alpha only → no dark fringe
    return img


SPRITES = [cotton_sprite(r) for r in (14, 22, 34, 50, 70)]
PUFFS = [dict(x=random.uniform(0, W), y=random.uniform(0, H), k=random.randrange(len(SPRITES)),
              v=random.uniform(8, 22), ph=random.uniform(0, 6.28), a=random.uniform(0.35, 0.9)) for _ in range(34)]


def draw_cotton(frame, t, strength=1.0):
    for p in PUFFS:
        spr = SPRITES[p["k"]]
        y = (p["y"] - t * p["v"] * (1 + p["k"] * 0.25)) % (H + 300) - 150
        x = p["x"] + math.sin(t * 0.35 + p["ph"]) * 28
        a = p["a"] * strength * (0.75 + 0.25 * math.sin(t * 0.8 + p["ph"]))
        img = spr if a >= 0.99 else _fade(spr, a, p["k"])
        frame.alpha_composite(img, (int(x - spr.width / 2), int(y - spr.height / 2)))


_fade_cache = {}


def _fade(spr, a, k):
    q = round(a * 20) / 20
    key = (k, q)
    if key not in _fade_cache:
        im = spr.copy()
        im.putalpha(spr.getchannel("A").point([int(v * q) for v in range(256)]))
        _fade_cache[key] = im
    return _fade_cache[key]


# ─────────────────────────── script (솜솜철학 key ideas) ───────────────────────────
T = [i * BAR for i in range(10)]  # bar boundaries: 0, 3.33, 6.67 … 30

IDEAS = [  # (start, label, line1, line2)
    (T[3], "01  ·  선택의 자유", "가능성의 자유가 갈림길 앞의 자유라면,",
     "선택의 자유는 길을 고른 뒤에도 내 삶의 저자로 살아가는 자유다."),
    (T[4], "02  ·  Second Chance, not Reset", "백 번 다시 시작해도 선택은 달라질 수 있지만,",
     "나를 선택한다는 선택만은 달라지지 않는다."),
    (T[5], "03  ·  오픈북 내러티브", "열려 있다는 것은 선택하지 않는다는 뜻이 아니다.",
     "선택한 뒤에도 다음 문장이 남아 있다는 뜻이다."),
    (T[6], "04  ·  동기와 행위", "나의 동기는 나의 이야기다.",
     "그러나 나의 행동은 타인의 삶에도 쓰인다."),
    (T[7], "05  ·  비단죄", "행위는 판단하고, 결과에는 책임을 진다.",
     "그러나 그 책임을 존재 전체의 최종 판결로 만들지 않는다."),
]


def scene(frame, t):
    draw_cotton(frame, t, 1.0)
    cx = W // 2

    # ── title: 솜솜철학 ─────────────────────────────
    a = 1 - ease((t - (T[1] - 0.6)) / 0.6)
    if a > 0:
        line(frame, "SOMSOM PHILOSOPHY", font("cormorant.ttf", 34), SOFT, cx, 440, ease((t - 0.3) / 1.4), a, tracking=12)
        line(frame, "솜솜철학", font("myeongjo-b.ttf", 120), INK, cx, 560, ease((t - 0.8) / 1.3), a, tracking=10)
        lw = int(180 * ease_out((t - 1.6) / 1.0))
        if lw > 0:
            ImageDraw.Draw(frame).line([(cx - lw, 660), (cx + lw, 660)], fill=ROSE + (int(160 * a),), width=2)

    # ── main thesis ──────────────────────────────
    a = ease((t - T[1]) / 0.4) * (1 - ease((t - (T[3] - 0.6)) / 0.6))
    if a > 0:
        drift = (t - T[1]) * 3
        line(frame, "존재에는", font("myeongjo.ttf", 84), SOFT, cx, 420 - drift, ease((t - (T[1] + 0.2)) / 1.1), a)
        line(frame, "우열이 없다.", font("myeongjo-b.ttf", 150), INK, cx, 560 - drift, ease((t - (T[1] + 1.1)) / 1.5), a, tracking=6)
        line(frame, "No existence stands above or below another.", font("cormorant-i.ttf", 42), ROSE, cx, 710 - drift,
             ease((t - (T[1] + 3.0)) / 1.4), a)

    # ── key ideas ────────────────────────────────
    for st, label, l1, l2 in IDEAS:
        if not (st - 0.1 <= t <= st + BAR + 0.1):
            continue
        a = ease((t - st) / 0.35) * (1 - ease((t - (st + BAR - 0.45)) / 0.45))
        drift = (t - st) * 4
        line(frame, label, font("gowun.ttf", 34), ROSE, cx, 380 - drift, ease((t - st) / 0.6), a, tracking=2)
        lw = int(46 * ease_out((t - st - 0.2) / 0.6))
        if lw > 0:
            ImageDraw.Draw(frame).line([(cx - lw, 420 - drift), (cx + lw, 420 - drift)], fill=ROSE + (int(140 * a),), width=2)
        line(frame, l1, font("myeongjo.ttf", 56), SOFT, cx, 520 - drift, ease((t - (st + 0.15)) / 0.9), a)
        line(frame, l2, font("myeongjo-b.ttf", 60), INK, cx, 625 - drift, ease((t - (st + 0.75)) / 1.1), a)

    # ── finale ───────────────────────────────────
    st = T[8]
    a = ease((t - st) / 0.5)
    if a > 0:
        line(frame, "존재에는 우열이 없다.", font("myeongjo-b.ttf", 110), INK, cx, 500, ease((t - (st + 0.1)) / 1.4), a, tracking=4)
        line(frame, "솜솜철학  ·  솜이", font("gowun.ttf", 40), ROSE, cx, 640, ease((t - (st + 0.8)) / 0.9), a, tracking=4)
        line(frame, "SOMSOM PHILOSOPHY", font("cormorant.ttf", 28), SOFT, cx, 700, ease((t - (st + 1.0)) / 0.9), a, tracking=12)


def render_frame(i):
    t = i / FPS
    frame = Image.fromarray(np.uint8(np.clip(BASE, 0, 255))).convert("RGBA")
    scene(frame, t)
    arr = np.asarray(frame.convert("RGB"), dtype=np.float32) + GRAIN[i % len(GRAIN)]
    g = ease(t / 0.8) * (1 - ease((t - 28.9) / 1.1))
    white = np.array(PAPER, np.float32) * 0.15  # fade through dim paper, not pure black
    arr = arr * g + white * (1 - g)
    return np.uint8(np.clip(arr, 0, 255))


# ─────────────────────────── music ───────────────────────────
N = int(SR * DUR)
PADN = N + SR * 6
tt = np.arange(N) / SR


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def add(buf, start, sig):
    s0 = int(start * SR)
    if s0 >= len(buf):
        return
    seg = sig[: len(buf) - s0]
    buf[s0:s0 + len(seg)] += seg


def piano(buf, start, midi, dur, vel):
    """Felt piano: warm, few harmonics, soft hammer."""
    f = mtof(midi)
    ln = int((dur + 3.0) * SR)
    x = np.arange(ln) / SR
    tone = np.zeros(ln)
    for h, amp in [(1, 1.0), (2, 0.32), (3, 0.12), (4, 0.05)]:
        fh = f * h * (1 + 0.0003 * h * h)
        tone += amp * np.sin(2 * np.pi * fh * x) * np.exp(-x * (0.7 + 0.8 * h) * (f / 440) ** 0.35)
    att = np.minimum(1, x / 0.012)
    rel = np.where(x > dur, np.exp(-(x - dur) / 0.6), 1)
    felt = lfilter([0.05], [1, -0.95], np.random.randn(ln)) * np.exp(-x / 0.015) * 0.5
    add(buf, start, (tone * att * rel + felt) * vel)


def bowed(buf, start, midi, dur, vel, bright=6):
    """Strings / cello: additive saw-like tone, slow bow attack, gentle vibrato."""
    f = mtof(midi)
    ln = int((dur + 1.5) * SR)
    x = np.arange(ln) / SR
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * x + random.uniform(0, 6)) * np.clip(x / 0.8, 0, 1)
    ph = 2 * np.pi * f * np.cumsum(vib) / SR
    tone = sum(np.sin(h * ph) / h ** 1.3 for h in range(1, bright + 1))
    e = np.clip(x / 0.9, 0, 1) ** 1.5 * np.where(x > dur, np.exp(-(x - dur) / 0.5), 1)
    swell = 1 + 0.12 * np.sin(2 * np.pi * x / max(dur, 1) * 0.5)
    add(buf, start, tone * e * swell * vel)


def swell_noise(buf, start, length, vel):
    ln = int(length * SR)
    x = np.arange(ln) / SR
    n = lfilter([0.03], [1, -0.97], np.random.randn(ln))
    e = np.sin(np.pi * np.clip(x / length, 0, 1)) ** 2
    add(buf, start - length * 0.7, n * e * vel)


CH = {  # (cello root, piano arp notes, string pad notes)
    "Dm9": (38, [50, 57, 60, 64, 65, 69], [62, 65, 69, 72, 76]),
    "Bbmaj7": (46, [46, 53, 57, 62, 65, 69], [62, 65, 69, 70]),
    "F/A": (45, [45, 53, 57, 60, 65, 69], [60, 65, 69, 72]),
    "Csus2": (48, [48, 55, 60, 62, 67, 72], [60, 62, 67, 72]),
    "Gm9": (43, [43, 50, 53, 57, 58, 62], [58, 62, 65, 69]),
    "Asus4": (45, [45, 52, 57, 62, 64, 69], [62, 64, 69]),
    "A7": (45, [45, 52, 55, 61, 64, 67], [61, 64, 67, 69]),
    "Fadd9": (41, [41, 48, 53, 55, 57, 60, 65], [65, 67, 69, 72]),
}
PROG = [
    [("Dm9", 4)], [("Bbmaj7", 4)], [("F/A", 4)], [("Csus2", 4)],
    [("Dm9", 4)], [("Bbmaj7", 4)], [("Gm9", 4)], [("Asus4", 2), ("A7", 2)],
    [("Bbmaj7", 2), ("Fadd9", 2)],
]
MEL = [  # (bar, beat, midi, beats)
    (2, 0, 72, 2), (2, 2, 74, 1), (2, 3, 76, 1),
    (3, 0, 79, 3), (3, 3, 76, 1),
    (4, 0, 77, 2), (4, 2, 76, 1), (4, 3, 74, 1),
    (5, 0, 74, 3), (5, 3, 69, 1),
    (6, 0, 70, 2), (6, 2, 72, 1), (6, 3, 74, 1),
    (7, 0, 76, 2), (7, 2, 73, 2),
    (8, 0, 74, 2), (8, 2, 72, 3), (8, 2.5, 81, 3),
]
ARP = [0, 2, 4, 3, 1, 3, 5, 2]


def compose():
    pno = np.zeros(PADN)
    strg = np.zeros(PADN)
    fx = np.zeros(PADN)
    for bi, bar in enumerate(PROG):
        pos = 0
        for name, beats in bar:
            root, arp, pads = CH[name]
            st = bi * BAR + pos * BEAT
            final = name == "Fadd9"
            if bi == 0:  # sparse opening
                piano(pno, st, arp[0], 2 * BEAT, 0.14)
                piano(pno, st + BEAT, arp[3], 2 * BEAT, 0.10)
                piano(pno, st + 2 * BEAT, arp[5], 2 * BEAT, 0.10)
                piano(pno, st + 3 * BEAT, arp[4], BEAT, 0.08)
            elif final:
                for k, m in enumerate(arp):
                    piano(pno, st + k * 0.09, m, 2.8, 0.13)
            else:
                for e in range(beats * 2):
                    m = arp[ARP[(pos * 2 + e) % 8] % len(arp)]
                    piano(pno, st + e * BEAT / 2 + random.uniform(-0.008, 0.008), m, BEAT * 0.8,
                          (0.10 if e % 2 == 0 else 0.07) * (0.85 if bi < 3 else 1.0))
            if bi >= 1:
                for m in pads:
                    bowed(strg, st, m, beats * BEAT + (1.5 if final else 0.15), 0.028 if bi < 4 else 0.036, bright=5)
            if bi >= 4:
                bowed(strg, st, root, beats * BEAT + (1.5 if final else 0.1), 0.11, bright=8)
            pos += beats
    for bar, beat, m, beats in MEL:
        piano(pno, bar * BAR + beat * BEAT, m, beats * BEAT, 0.20 if m < 80 else 0.08)
    for st, *_ in IDEAS:
        swell_noise(fx, st, 1.6, 0.25)
    swell_noise(fx, T[1], 2.2, 0.35)
    swell_noise(fx, T[8], 2.2, 0.35)
    # hall reverb
    ir_len = int(3.2 * SR)
    ir = np.random.randn(ir_len) * np.exp(-np.arange(ir_len) / SR / 0.9)
    ir = lfilter([0.25], [1, -0.75], ir)
    ir /= np.sqrt(np.sum(ir ** 2)) * 6
    dry = pno + strg * 0.9
    wet = fftconvolve(dry, ir)[: len(dry)]
    mix = (dry * 0.75 + wet * 1.0 + fx)[:N]
    fade = np.clip((DUR - tt) / 2.2, 0, 1) ** 1.3 * np.clip(tt / 0.2, 0, 1)
    mix *= fade
    mix = np.tanh(mix / np.max(np.abs(mix)) * 1.2) * 0.82
    wetr = fftconvolve(dry, np.roll(ir, 331))[:N] * fade
    wetr = wetr / (np.max(np.abs(wetr)) + 1e-9) * 0.12
    left, right = mix, np.clip(mix * 0.94 + wetr, -1, 1)
    return np.int16(np.clip(np.stack([left, right], 1), -1, 1) * 32767)


def main():
    wav_path = os.path.join(HERE, ".somsom-audio.wav")
    with wave.open(wav_path, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(compose().tobytes())
    print("audio done")
    only = [int(a) for a in sys.argv[1:]]  # optional: preview frame numbers → PNG
    if only:
        for i in only:
            Image.fromarray(render_frame(i)).save(os.path.join(HERE, f".preview-{i:04d}.png"))
        return
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [ff, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-i", wav_path, "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", OUT]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(NFRAMES):
        proc.stdin.write(render_frame(i).tobytes())
        if i % 150 == 0:
            print(f"frame {i}/{NFRAMES}")
    proc.stdin.close()
    proc.wait()
    os.remove(wav_path)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
