import difflib

import cv2
import numpy as np
from rapidocr import RapidOCR

from .device import ocr_params
from .grouping import merge_tracks, summarize
from .mask import text_style
from .translate import Translator
from .util import emit, has_cjk, iou, pad_box

IOU_SAME_TEXT = 0.3
TEXT_SIM_SAME = 0.5
PRESENT_SIM = 0.6


def sim(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio()


def contained(text, crop_text):
    """Fraction of `text` found in `crop_text`; tolerates neighbouring text captured by the crop."""
    if not text:
        return 0.0
    blocks = difflib.SequenceMatcher(None, crop_text, text).get_matching_blocks()
    return sum(b.size for b in blocks) / len(text)


def clamp_box(box, w, h):
    x0 = max(0, int(box[0]))
    y0 = max(0, int(box[1]))
    x1 = min(w, int(box[0] + box[2]))
    y1 = min(h, int(box[1] + box[3]))
    return [x0, y0, max(1, x1 - x0), max(1, y1 - y0)]


class Detector:
    def __init__(self, cfg):
        params, self.device = ocr_params(cfg.get("device", "auto"))
        self.engine = RapidOCR(params=params)
        self.min_score = cfg.get("min_score", 0.6)
        self.only_cjk = cfg.get("only_cjk", True)
        self.max_side = cfg.get("max_side", 1600)

    def _scale(self, frame):
        longest = max(frame.shape[:2])
        return min(1.0, self.max_side / longest)

    def detect(self, frame):
        scale = self._scale(frame)
        img = frame if scale == 1.0 else cv2.resize(frame, None, fx=scale, fy=scale)
        result = self.engine(img)
        if result.boxes is None or len(result.boxes) == 0:
            return []
        items = []
        for box, text, score in zip(result.boxes, result.txts, result.scores):
            if score < self.min_score or (self.only_cjk and not has_cjk(text)):
                continue
            xs, ys = box[:, 0] / scale, box[:, 1] / scale
            x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
            items.append({"box": [x0, y0, x1 - x0, y1 - y0], "text": text, "score": float(score), "lines": 1})
        return items

    def crop_info(self, frame, box, pad_ratio=0.08):
        """OCR a single region; returns (text, number of text rows)."""
        fh, fw = frame.shape[:2]
        pad = int(max(box[2], box[3]) * pad_ratio) + 4
        x0, y0 = max(0, int(box[0]) - pad), max(0, int(box[1]) - pad)
        x1, y1 = min(fw, int(box[0] + box[2]) + pad), min(fh, int(box[1] + box[3]) + pad)
        result = self.engine(frame[y0:y1, x0:x1])
        if result.txts is None or result.boxes is None:
            return "", 0
        order = sorted(range(len(result.txts)), key=lambda i: (result.boxes[i][:, 1].mean(), result.boxes[i][:, 0].min()))
        rows, last_y = 0, None
        for i in order:
            ys = result.boxes[i][:, 1]
            if last_y is None or ys.mean() - last_y > 0.6 * (ys.max() - ys.min()):
                rows += 1
            last_y = ys.mean()
        return "".join(result.txts[i] for i in order), rows

    def crop_text(self, frame, box):
        return self.crop_info(frame, box)[0]


def refine_span(present, first, last, step, total):
    """Binary-search the exact first/last frame where a caption is present.
    `first`/`last` are sampled frames known to contain it; the neighbours `step` frames away do not."""
    if first > 0:
        lo, hi = max(0, first - step), first
        while lo + 1 < hi:
            mid = (lo + hi) // 2
            if present(mid):
                hi = mid
            else:
                lo = mid
        first = hi
    lo, hi = last, min(total, last + step)
    while lo + 1 < hi:
        mid = (lo + hi) // 2
        if present(mid):
            lo = mid
        else:
            hi = mid
    return first, (lo + 1 if hi < total else total)


def estimate_style(frame, box, lines):
    fh, fw = frame.shape[:2]
    x0, y0, x1, y1 = pad_box(clamp_box(box, fw, fh), fw, fh)
    return text_style(frame[y0:y1, x0:x1], box[3] / max(1, lines))


def run(cfg):
    video = cfg["video"]
    sample_fps = float(cfg.get("sample_fps", 2))
    miss_tolerance = int(cfg.get("miss_tolerance", 2))

    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    step = max(1, round(fps / sample_fps))

    emit(type="info", fps=fps, frames=total, width=width, height=height, duration=total / fps)
    detector = Detector(cfg)
    emit(type="warn", message=f"OCR device: {detector.device}")

    tracks, closed = [], []
    prev_small, prev_dets = None, []
    idx = 0
    while True:
        if idx % step:
            if not cap.grab():
                break
            idx += 1
            continue
        ok, frame = cap.read()
        if not ok:
            break

        small = cv2.cvtColor(cv2.resize(frame, (96, 54)), cv2.COLOR_BGR2GRAY).astype(np.int16)
        if prev_small is not None and float(np.abs(small - prev_small).mean()) < 0.8:
            dets = prev_dets
        else:
            dets = detector.detect(frame)
        prev_small, prev_dets = small, dets

        unmatched = list(range(len(tracks)))
        for det in dets:
            best, best_score = None, 0.0
            for ti in unmatched:
                t = tracks[ti]
                overlap = iou(t["last_box"], det["box"])
                s = sim(t["last_text"], det["text"])
                if (overlap > IOU_SAME_TEXT and s >= TEXT_SIM_SAME) or (overlap > 0.05 and s >= 0.85):
                    score = overlap + s
                    if score > best_score:
                        best, best_score = ti, score
            if best is None:
                tracks.append({
                    "first": idx, "last": idx, "hits": [det], "last_box": det["box"], "last_text": det["text"],
                    "style": estimate_style(frame, det["box"], det["lines"]),
                })
            else:
                t = tracks[best]
                t["last"], t["last_box"], t["last_text"] = idx, det["box"], det["text"]
                t["hits"].append(det)
                unmatched.remove(best)

        still = []
        for t in tracks:
            (closed if idx - t["last"] > miss_tolerance * step else still).append(t)
        tracks = still

        if total:
            emit(type="progress", stage="scan", pct=min(99, int(idx * 100 / total)))
        idx += 1

    closed.extend(tracks)
    min_hits = int(cfg.get("min_hits", 1))
    closed = [t for t in closed if len(t["hits"]) >= min_hits]
    closed.sort(key=lambda t: t["first"])

    for t in closed:
        summarize(t)
    closed = merge_tracks(closed, step, cfg.get("merge", "smart"))
    closed.sort(key=lambda t: (t["first"], t["box"][1]))

    segments = []
    for n, t in enumerate(closed):
        emit(type="progress", stage="refine", pct=int(n * 100 / max(1, len(closed))))
        text, lines = t["text"], t["lines"]
        box = clamp_box(t["box"], width, height)
        plain = text.replace(" ", "")

        def present(frame_idx):
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ok, frame = cap.read()
            return ok and contained(plain, detector.crop_text(frame, box)) >= PRESENT_SIM

        first, end_idx = refine_span(present, t["first"], t["last"], step, total)

        segments.append({
            "id": n + 1,
            "start": round(first / fps, 3),
            "end": round(end_idx / fps, 3),
            "box": box,
            "lines": lines,
            **t["style"],
            "size_scale": 1.0,
            "font": "",
            "score": round(t["score_sum"] / t["score_n"], 3),
            "text_zh": text,
            "text_vi": "",
            "enabled": True,
        })
    cap.release()

    translator = Translator(cfg.get("source", "zh-CN"), cfg.get("target", "vi"), cfg.get("glossary"),
                            cfg.get("engine", "auto"))
    errors = 0
    for i, seg in enumerate(segments):
        try:
            seg["text_vi"] = translator.translate(seg["text_zh"])
        except Exception as exc:
            errors += 1
            emit(type="warn", message=str(exc))
        emit(type="progress", stage="translate", pct=int((i + 1) * 100 / max(1, len(segments))))

    emit(type="result", segments=segments, translate_errors=errors,
         video={"fps": fps, "frames": total, "width": width, "height": height, "duration": total / fps})


def ocr_region(cfg):
    """OCR one user-drawn region: text, translation, colour and the time span it stays on screen."""
    cap = cv2.VideoCapture(cfg["video"])
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {cfg['video']}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step = max(1, round(fps / float(cfg.get("sample_fps", 2))))
    box = [int(v) for v in cfg["box"]]
    idx = min(total - 1, int(float(cfg["time"]) * fps))

    detector = Detector({"min_score": 0.3, "only_cjk": False, "device": cfg.get("device", "auto")})

    def frame_at(i):
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, frame = cap.read()
        return frame if ok else None

    frame = frame_at(idx)
    text, rows = detector.crop_info(frame, box)
    first = last = idx
    if text:
        plain = text.replace(" ", "")

        def present(i):
            f = frame_at(i)
            return f is not None and contained(plain, detector.crop_text(f, box)) >= PRESENT_SIM

        while first - step >= 0 and present(first - step):
            first -= step
        while last + step < total and present(last + step):
            last += step
        first, end_idx = refine_span(present, first, last, step, total)
    else:
        end_idx = min(total, idx + int(2 * fps))
    cap.release()

    translator = Translator(cfg.get("source", "zh-CN"), cfg.get("target", "vi"), cfg.get("glossary"),
                            cfg.get("engine", "auto"))
    try:
        text_vi = translator.translate(text) if text else ""
    except Exception as exc:
        emit(type="warn", message=str(exc))
        text_vi = ""
    emit(type="result", text_zh=text, text_vi=text_vi, start=round(first / fps, 3), end=round(end_idx / fps, 3),
         lines=max(1, rows), **estimate_style(frame, box, max(1, rows)))
