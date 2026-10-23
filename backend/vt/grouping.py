import math


def summarize(track):
    """Collapse a track's per-frame detections into one text, one box and a confidence."""
    votes = {}
    for hit in track["hits"]:
        votes.setdefault(hit["text"], [0, 0.0])
        votes[hit["text"]][0] += 1
        votes[hit["text"]][1] += hit["score"]
    track["text"] = max(votes, key=lambda k: tuple(votes[k]))
    x0 = min(h["box"][0] for h in track["hits"])
    y0 = min(h["box"][1] for h in track["hits"])
    x1 = max(h["box"][0] + h["box"][2] for h in track["hits"])
    y1 = max(h["box"][1] + h["box"][3] for h in track["hits"])
    track["box"] = [x0, y0, x1 - x0, y1 - y0]
    track["lines"] = 1
    track["score_sum"] = sum(v[1] for v in votes.values())
    track["score_n"] = sum(v[0] for v in votes.values())


def _color_distance(a, b):
    ra, rb = int(a.lstrip("#"), 16), int(b.lstrip("#"), 16)
    return math.dist(((ra >> 16) & 255, (ra >> 8) & 255, ra & 255), ((rb >> 16) & 255, (rb >> 8) & 255, rb & 255))


def _can_stack(a, b, step, loose):
    """True if track `b` is the next line of the same caption as track `a` (a sits above b)."""
    ax, ay, aw, ah = a["box"]
    bx, by, bw, bh = b["box"]
    line_a, line_b = ah / a["lines"], bh / b["lines"]
    gap = by - (ay + ah)
    overlap = min(ax + aw, bx + bw) - max(ax, bx)
    if overlap < 0.3 * min(aw, bw):
        return False
    if loose:
        return gap < 0.8 * max(line_a, line_b) and 0.6 < line_b / line_a < 1.6
    aligned = abs((ax + aw / 2) - (bx + bw / 2)) <= 0.12 * max(aw, bw) or abs(ax - bx) <= 0.06 * max(aw, bw)
    same_time = abs(a["first"] - b["first"]) <= step and abs(a["last"] - b["last"]) <= step
    same_look = _color_distance(a["style"]["color"], b["style"]["color"]) < 70
    return (
        aligned and same_time and same_look
        and 0.75 < line_b / line_a < 1.33
        and -0.2 * line_a <= gap <= 0.5 * max(line_a, line_b)
    )


def merge_tracks(tracks, step, mode="smart"):
    """Join stacked lines of one multi-line caption. 'smart' needs the lines to appear and disappear together
    and to share alignment, height and colour, so separate texts that merely sit close together stay apart."""
    if mode == "off":
        return tracks
    loose = mode == "loose"
    tracks = sorted(tracks, key=lambda t: t["box"][1])
    merged = True
    while merged:
        merged = False
        for i, a in enumerate(tracks):
            for j, b in enumerate(tracks):
                if i != j and a["box"][1] <= b["box"][1] and _can_stack(a, b, step, loose):
                    ax, ay, aw, ah = a["box"]
                    bx, by, bw, bh = b["box"]
                    x0, y0 = min(ax, bx), ay
                    a["box"] = [x0, y0, max(ax + aw, bx + bw) - x0, max(ay + ah, by + bh) - y0]
                    a["text"] = f"{a['text']} {b['text']}"
                    a["lines"] += b["lines"]
                    a["hits"] += b["hits"]
                    a["first"], a["last"] = min(a["first"], b["first"]), max(a["last"], b["last"])
                    a["score_sum"] += b["score_sum"]
                    a["score_n"] += b["score_n"]
                    del tracks[j]
                    merged = True
                    break
            if merged:
                break
    return tracks
