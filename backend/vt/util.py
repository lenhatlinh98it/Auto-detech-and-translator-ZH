import json
import os
import re
import sys

_OUT = sys.__stdout__
sys.stdout = sys.stderr  # keep stdout clean for JSON lines; library logs go to stderr

CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")

FONT_CANDIDATES = [
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/tahoma.ttf",
]


def emit(**payload):
    _OUT.write(json.dumps(payload, ensure_ascii=False) + "\n")
    _OUT.flush()


def has_cjk(text):
    return bool(CJK_RE.search(text))


FONT_DIR = "C:/Windows/Fonts/"
FONT_PRESETS = {
    "Arial": "arial.ttf", "Arial Bold": "arialbd.ttf", "Arial Black": "ariblk.ttf",
    "Segoe UI": "segoeui.ttf", "Segoe UI Bold": "segoeuib.ttf", "Tahoma": "tahoma.ttf", "Tahoma Bold": "tahomabd.ttf",
    "Verdana Bold": "verdanab.ttf", "Times New Roman Bold": "timesbd.ttf", "Georgia Bold": "georgiab.ttf",
    "Trebuchet MS Bold": "trebucbd.ttf", "Comic Sans MS Bold": "comicbd.ttf", "Impact": "impact.ttf",
}


def find_font(name=None):
    """`name` is a font file path or one of FONT_PRESETS; falls back to a default Vietnamese-capable font."""
    if name and os.path.isfile(name):
        return name
    if name in FONT_PRESETS and os.path.isfile(FONT_DIR + FONT_PRESETS[name]):
        return FONT_DIR + FONT_PRESETS[name]
    for path in FONT_CANDIDATES:
        if os.path.isfile(path):
            return path
    raise FileNotFoundError("No usable font found; set a font file in Settings")


def pad_box(box, frame_w, frame_h, ratio=0.12):
    x, y, w, h = box
    pad = max(3, int(min(w, h) * ratio))
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(frame_w, x + w + pad), min(frame_h, y + h + pad)
    return x0, y0, x1, y1


def iou(a, b):
    ax2, ay2 = a[0] + a[2], a[1] + a[3]
    bx2, by2 = b[0] + b[2], b[1] + b[3]
    iw = min(ax2, bx2) - max(a[0], b[0])
    ih = min(ay2, by2) - max(a[1], b[1])
    if iw <= 0 or ih <= 0:
        return 0.0
    inter = iw * ih
    return inter / (a[2] * a[3] + b[2] * b[3] - inter)
