import cv2
import numpy as np

ERASE_THRESHOLD = 35
COLOR_THRESHOLD = 90


def text_mask(crop, line_h, threshold=ERASE_THRESHOLD):
    """Mask of thin text strokes (fill + outline), found by comparing the crop with a
    background estimate where strokes thinner than the kernel have been removed."""
    k = max(5, int(line_h * 0.35)) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    background = cv2.morphologyEx(cv2.morphologyEx(crop, cv2.MORPH_OPEN, kernel), cv2.MORPH_CLOSE, kernel)
    diff = cv2.absdiff(crop, background).max(axis=2)
    return (diff > threshold).astype(np.uint8) * 255


def text_style(crop, line_h):
    """Estimate fill colour, outline colour and outline width (px) of the text inside a crop.

    The crop is split into colour clusters. Clusters that make up the crop border are background; of the
    remaining ones the cluster touching the background most is the outline (the fill is enclosed by it)."""
    plain = {"color": "#ffffff", "stroke": "", "stroke_w": 0}
    h, w = crop.shape[:2]
    if h < 6 or w < 6:
        return plain
    pixels = crop.reshape(-1, 3).astype(np.float32)
    samples = pixels if len(pixels) <= 6000 else pixels[np.random.default_rng(0).choice(len(pixels), 6000, replace=False)]
    k = 4
    _, _, centers = cv2.kmeans(samples, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0), 3,
                               cv2.KMEANS_PP_CENTERS)
    label = np.stack([np.linalg.norm(crop.astype(np.float32) - c, axis=2) for c in centers]).argmin(axis=0)

    border = np.zeros((h, w), bool)
    border[:2], border[-2:], border[:, :2], border[:, -2:] = True, True, True, True
    share = np.bincount(label[border], minlength=k) / border.sum()
    bg_ids = [i for i in range(k) if share[i] >= 0.12]
    counts = np.bincount(label.ravel(), minlength=k)
    fg_ids = sorted((i for i in range(k) if i not in bg_ids and counts[i] >= 0.02 * label.size), key=lambda i: -counts[i])[:2]
    if not fg_ids:
        return plain
    if len(fg_ids) == 1:
        return {"color": _hex(centers[fg_ids[0]]), "stroke": "", "stroke_w": 0}

    ones = np.ones((3, 3), np.uint8)
    bg_near = cv2.dilate(np.isin(label, bg_ids).astype(np.uint8), ones) > 0
    touch = [(bg_near & (label == i)).sum() / max(1, (label == i).sum()) for i in fg_ids]
    outline_i, fill_i = (fg_ids[0], fg_ids[1]) if touch[0] >= touch[1] else (fg_ids[1], fg_ids[0])
    out_mask = (label == outline_i).astype(np.uint8)
    band = int((out_mask - cv2.erode(out_mask, ones)).sum())
    width = 2.0 * int(out_mask.sum()) / max(1, band)
    if width < 1.5 or counts[outline_i] < 0.25 * counts[fill_i]:
        return {"color": _hex(centers[fill_i]), "stroke": "", "stroke_w": 0}
    return {
        "color": _hex(centers[fill_i]),
        "stroke": _hex(centers[outline_i]),
        "stroke_w": round(min(line_h * 0.15, width), 1),
    }


def _hex(bgr):
    b, g, r = bgr
    return "#{:02x}{:02x}{:02x}".format(int(r), int(g), int(b))
