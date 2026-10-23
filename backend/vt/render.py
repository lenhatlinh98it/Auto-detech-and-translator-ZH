import subprocess

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .mask import text_mask
from .util import emit, find_font, pad_box

MIN_FONT = 8
LINE_SPACING = 1.15


def hex_to_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def contrast_color(rgb):
    luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
    return (0, 0, 0) if luminance > 140 else (255, 255, 255)


def erase(frame, seg, mode):
    fh, fw = frame.shape[:2]
    x0, y0, x1, y1 = pad_box(seg["box"], fw, fh)
    crop = frame[y0:y1, x0:x1]
    if crop.size == 0:
        return

    if mode == "box":
        border = np.concatenate([crop[0], crop[-1], crop[:, 0], crop[:, -1]])
        crop[:] = np.median(border, axis=0).astype(np.uint8)
        return

    mask = np.full(crop.shape[:2], 255, np.uint8)
    if mode == "smart":
        line_h = seg["box"][3] / max(1, seg.get("lines", 1))
        strokes = text_mask(crop, line_h)
        if 0.01 < strokes.mean() / 255 < 0.6:
            k = max(5, int(line_h * 0.2)) | 1
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
            mask = cv2.dilate(cv2.morphologyEx(strokes, cv2.MORPH_CLOSE, kernel), kernel)
    frame[y0:y1, x0:x1] = cv2.inpaint(crop, mask, 3, cv2.INPAINT_TELEA)


class TextLayout:
    def __init__(self, seg, frame_w, frame_h, font_path):
        self.lines, self.font, self.origin, self.stroke = [], None, (0, 0), 0
        text = (seg.get("text_vi") or "").strip()
        if not text:
            return
        x, y, w, h = seg["box"]
        lines = max(1, seg.get("lines", 1))
        base = max(MIN_FONT, int(h / lines * 0.85 * float(seg.get("size_scale") or 1.0)))
        cx, cy = x + w / 2, y + h / 2
        stroke_w = seg.get("stroke_w")

        # Largest font size at which the translation fits inside the original text box. If that would be
        # unreadably small, the box is relaxed a little (up to 1.7x wide, 1.5x high) before shrinking further.
        readable = max(12, int(frame_h * 0.022))
        for grow_w, grow_h in ((1.0, 1.0), (1.35, 1.25), (1.7, 1.5)):
            max_w, max_h = w * grow_w, h * grow_h
            for size in range(base, MIN_FONT - 1, -1):
                font = ImageFont.truetype(font_path, size)
                stroke = max(1, size // 12) if stroke_w is None else int(round(stroke_w * size / base))
                wrapped = self._wrap(text, font, max_w - 2 * stroke)
                widest = max(font.getlength(line) for line in wrapped) + 2 * stroke
                if len(wrapped) * int(size * LINE_SPACING) <= max_h * 1.05 and widest <= max_w * 1.02:
                    break
            if size >= min(readable, base):
                break
        self.font, self.lines, self.stroke = font, wrapped, stroke
        self.line_h = int(font.size * LINE_SPACING)
        widths = [font.getlength(line) for line in wrapped]
        self.block_w = int(max(widths)) if widths else 0
        self.block_h = self.line_h * len(wrapped)
        ox = min(max(0, cx - self.block_w / 2), frame_w - self.block_w)
        oy = min(max(0, cy - self.block_h / 2), frame_h - self.block_h)
        self.origin = (int(ox), int(oy))
        self.widths = widths

    @staticmethod
    def _wrap(text, font, max_w):
        words, lines, cur = text.split(), [], ""
        for word in words:
            trial = f"{cur} {word}".strip()
            if cur and font.getlength(trial) > max_w:
                lines.append(cur)
                cur = word
            else:
                cur = trial
        if cur:
            lines.append(cur)
        return lines


def draw_text(frame, layout, seg, style):
    if not layout.lines:
        return
    fh, fw = frame.shape[:2]
    pad = layout.stroke + 2
    x0 = max(0, layout.origin[0] - pad)
    y0 = max(0, layout.origin[1] - pad)
    x1 = min(fw, layout.origin[0] + layout.block_w + pad)
    y1 = min(fh, layout.origin[1] + layout.block_h + pad + int(layout.font.size * 0.3))
    region = frame[y0:y1, x0:x1]
    img = Image.fromarray(cv2.cvtColor(region, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(img)

    override = style.get("textColor", "auto")
    fill = hex_to_rgb(seg.get("color") or "#ffffff") if override == "auto" else hex_to_rgb(override)
    outline = hex_to_rgb(seg["stroke"]) if seg.get("stroke") else contrast_color(fill)

    for i, line in enumerate(layout.lines):
        lx = layout.origin[0] - x0 + (layout.block_w - layout.widths[i]) / 2
        ly = layout.origin[1] - y0 + i * layout.line_h
        draw.text((lx, ly), line, font=layout.font, fill=fill, stroke_width=layout.stroke, stroke_fill=outline)
    frame[y0:y1, x0:x1] = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


class Renderer:
    def __init__(self, segments, frame_w, frame_h, style):
        self.style = style
        self.mode = style.get("eraseMode", "smart")
        default_font = style.get("font")
        self.segments = [s for s in segments if s.get("enabled", True)]
        self.layouts = {s["id"]: TextLayout(s, frame_w, frame_h, find_font(s.get("font") or default_font))
                        for s in self.segments}

    def apply(self, frame, t):
        for seg in self.segments:
            if seg["start"] <= t < seg["end"]:
                erase(frame, seg, self.mode)
        for seg in self.segments:
            if seg["start"] <= t < seg["end"]:
                draw_text(frame, self.layouts[seg["id"]], seg, self.style)
        return frame


ENCODERS = {
    "libx264": lambda crf, preset: ["-c:v", "libx264", "-crf", str(crf), "-preset", preset],
    "h264_nvenc": lambda crf, preset: ["-c:v", "h264_nvenc", "-rc", "vbr", "-cq", str(crf), "-b:v", "0", "-preset", "p5"],
    "h264_qsv": lambda crf, preset: ["-c:v", "h264_qsv", "-global_quality", str(crf)],
    "h264_amf": lambda crf, preset: ["-c:v", "h264_amf", "-rc", "cqp", "-qp_i", str(crf), "-qp_p", str(crf)],
}


def pick_encoder(ffmpeg, wanted):
    """Return `wanted` if ffmpeg can really open it on this machine, otherwise libx264."""
    if wanted in ("libx264", None, ""):
        return "libx264"
    probe = [ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.2",
             "-c:v", wanted, "-f", "null", "-"]
    if subprocess.run(probe, capture_output=True).returncode == 0:
        return wanted
    emit(type="warn", message=f"Encoder {wanted} is not available on this machine; using libx264 (CPU)")
    return "libx264"


def run(cfg):
    """Render the translated video. Optional cfg keys for quick previews: start, duration (seconds), scale_height."""
    video = cfg["video"]
    ffmpeg = cfg.get("ffmpeg", "ffmpeg")
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    renderer = Renderer(cfg["segments"], w, h, cfg.get("style", {}))

    start_idx = max(0, min(total - 1, int(float(cfg.get("start", 0)) * fps)))
    end_idx = total
    if cfg.get("duration"):
        end_idx = min(total, start_idx + int(float(cfg["duration"]) * fps))
    todo = max(1, end_idx - start_idx)
    if start_idx:
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_idx)

    encoder = pick_encoder(ffmpeg, cfg.get("encoder", "libx264"))
    cmd = [ffmpeg, "-y", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
           "-ss", f"{start_idx / fps:.3f}", "-t", f"{todo / fps:.3f}", "-i", video,
           "-map", "0:v", "-map", "1:a:0?"]
    if cfg.get("scale_height"):
        cmd += ["-vf", f"scale=-2:'min({int(cfg['scale_height'])},ih)'"]
    cmd += ENCODERS[encoder](cfg.get("crf", 18), cfg.get("preset", "medium"))
    cmd += ["-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", cfg["output"]]

    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    done = 0
    try:
        while done < todo:
            ok, frame = cap.read()
            if not ok:
                break
            proc.stdin.write(renderer.apply(frame, (start_idx + done) / fps).tobytes())
            done += 1
            if done % 15 == 0:
                emit(type="progress", stage="render", pct=min(99, int(done * 100 / todo)))
    except BrokenPipeError:
        pass
    finally:
        cap.release()
        try:
            proc.stdin.close()
        except BrokenPipeError:
            pass
    err = proc.stderr.read().decode("utf-8", "replace")
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg failed: {err.strip()}")
    emit(type="result", output=cfg["output"], frames=done, encoder=encoder)


def preview(cfg):
    cap = cv2.VideoCapture(cfg["video"])
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {cfg['video']}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    t = float(cfg["time"])
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise RuntimeError("Cannot read frame at the requested time")
    renderer = Renderer(cfg["segments"], w, h, cfg.get("style", {}))
    cv2.imencode(".png", renderer.apply(frame, t))[1].tofile(cfg["output"])
    emit(type="result", output=cfg["output"])


def probe(cfg):
    cap = cv2.VideoCapture(cfg["video"])
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {cfg['video']}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    emit(type="result", width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
         fps=fps, frames=frames, duration=frames / fps)
    cap.release()


def proxy(cfg):
    """Make a small H.264 copy for playback when the UI cannot decode the original codec."""
    cmd = [
        cfg.get("ffmpeg", "ffmpeg"), "-y", "-loglevel", "error", "-i", cfg["video"],
        "-vf", "scale=-2:'min(540,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", cfg["output"],
    ]
    done = subprocess.run(cmd, capture_output=True)
    if done.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {done.stderr.decode('utf-8', 'replace').strip()}")
    emit(type="result", output=cfg["output"])
