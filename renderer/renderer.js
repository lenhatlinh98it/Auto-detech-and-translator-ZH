const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  source: "zh-CN", target: "vi", engine: "auto", sampleFps: 2, minScore: 0.6, onlyCjk: true,
  eraseMode: "smart", textColor: "auto", font: "", crf: 18, preset: "medium", glossary: "",
  device: "auto", encoder: "libx264", merge: "smart",
};

const state = {
  video: null,
  info: null, // { width, height, duration, fps }
  segments: [],
  selectedId: null,
  settings: { ...DEFAULTS },
  drawMode: false,
  fonts: [],
  busy: false,
  activeSig: "",
  lastTime: -1,
};

// ---------- helpers ----------
const fileUrl = (p) => encodeURI("file:///" + p.replace(/\\/g, "/")).replace(/#/g, "%23").replace(/\?/g, "%3F");
const fmtTime = (t) => {
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const segById = (id) => state.segments.find((s) => s.id === id);
const nextId = () => state.segments.reduce((m, s) => Math.max(m, s.id), 0) + 1;
const fps = () => state.info?.fps || 30;
const duration = () => state.info?.duration || $("video").duration || 0;
const frameSize = () => ({ w: state.info?.width || $("video").videoWidth || 1, h: state.info?.height || $("video").videoHeight || 1 });

function parseGlossary() {
  const out = {};
  for (const line of state.settings.glossary.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function styleSettings() {
  return { eraseMode: state.settings.eraseMode, textColor: state.settings.textColor, font: state.settings.font || null };
}

function translateOptions() {
  const s = state.settings;
  return { source: s.source, target: s.target, engine: s.engine, glossary: parseGlossary() };
}

// ---------- progress / busy ----------
const STAGES = { scan: "Quét frame tìm chữ", refine: "Căn thời gian hiển thị", translate: "Dịch", render: "Ghi đè & xuất video" };

function setBusy(text) {
  state.busy = !!text;
  $("progressBar").classList.toggle("hidden", !text);
  $("progressText").textContent = text || "";
  $("pvStatus").textContent = text || "";
  $("progressFill").style.width = "0";
  refreshButtons();
}

function refreshButtons() {
  const has = !!state.video;
  $("btnOpen").disabled = state.busy;
  $("btnAnalyze").disabled = !has || state.busy;
  $("btnPreview").disabled = $("btnPreviewVideo").disabled = !has || state.busy || !state.segments.length;
  $("pvBuild").disabled = state.busy;
  $("pvCancel").classList.toggle("hidden", !state.busy);
  $("btnApply").disabled = !has || state.busy || !state.segments.length;
  $("btnRetransAll").disabled = $("btnRetransEmpty").disabled = $("btnReplace").disabled = state.busy || !state.segments.length;
}

window.api.onEvent((evt) => {
  if (evt.type === "progress") {
    $("progressFill").style.width = `${evt.pct}%`;
    $("progressText").textContent = $("pvStatus").textContent = `${STAGES[evt.stage] || evt.stage}… ${evt.pct}%`;
  } else if (evt.type === "warn") {
    $("progressText").textContent = $("pvStatus").textContent = evt.message.slice(0, 160);
  } else if (evt.type === "info") {
    state.info = { ...(state.info || {}), fps: evt.fps, width: evt.width, height: evt.height, duration: evt.duration };
  }
});

async function runJob(command, cfg, label) {
  setBusy(label);
  try {
    const res = await window.api.run(command, cfg);
    if (!res.ok && !res.cancelled) alert(`Lỗi: ${res.error}`);
    return res.ok ? res.result : null;
  } finally {
    setBusy(null);
  }
}

// ---------- persistence ----------
let saveTimer = null;
const projectFile = () => state.video + ".vtproj.json";

function markDirty() {
  if (!state.video) return;
  $("saveState").textContent = "Đang lưu…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await window.api.saveProject(projectFile(), { version: 1, video: state.video, info: state.info, segments: state.segments });
    $("saveState").textContent = "Đã lưu tự động";
  }, 700);
}

// ---------- video ----------
function loadPlayable(src) {
  const video = $("video");
  return new Promise((resolve) => {
    const done = (ok) => {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onOk);
      video.removeEventListener("error", onErr);
      resolve(ok);
    };
    const onOk = () => done(video.videoWidth > 0);
    const onErr = () => done(false);
    const timer = setTimeout(() => done(false), 5000);
    video.addEventListener("loadedmetadata", onOk);
    video.addEventListener("error", onErr);
    video.src = src;
  });
}

async function openVideo(path) {
  if (!path) return;
  const video = $("video");
  const probe = await runJob("probe", { video: path }, "Đang đọc thông tin video…");
  if (!probe) return;

  if (!(await loadPlayable(fileUrl(path)))) {
    // The embedded player cannot decode this codec (e.g. HEVC): play a small H.264 copy instead.
    const proxy = await window.api.proxyPath();
    if (!(await runJob("proxy", { video: path, output: proxy }, "Codec này không phát trực tiếp được, đang tạo bản xem nhanh…"))) return;
    if (!(await loadPlayable(fileUrl(proxy) + "?t=" + Date.now()))) {
      alert("Không phát được video này, kể cả bản xem nhanh.");
      return;
    }
  }

  state.video = path;
  state.segments = [];
  state.selectedId = null;
  state.info = { width: probe.width, height: probe.height, duration: probe.duration, fps: probe.fps };
  const saved = await window.api.loadProject(projectFile());
  if (saved?.segments?.length) state.segments = saved.segments;

  const ratio = probe.width / probe.height;
  $("stage").style.aspectRatio = String(ratio);
  $("stage").style.width = `min(100%, ${(ratio * 56).toFixed(1)}vh)`;
  $("empty").classList.add("hidden");
  $("stageWrap").classList.remove("hidden");
  $("previewImg").classList.add("hidden");
  $("btnClosePreview").classList.add("hidden");
  document.title = `Video Text Translator — ${path.split(/[\\/]/).pop()}`;
  $("saveState").textContent = saved?.segments?.length ? "Đã nạp project cũ" : "";
  renderAll();
}

function seek(t) {
  $("video").currentTime = Math.max(0, Math.min(duration(), t));
  tick(true);
}

function activeSegments(t) {
  return state.segments.filter((s) => t >= s.start && t < s.end);
}

// ---------- overlay boxes ----------
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};

// Approximates the backend text layout so the overlay shows the translated text in its own style.
function styleOverlayText(div, seg, k, frameW, frameH) {
  const s = state.settings;
  const fill = s.textColor === "auto" ? seg.color || "#ffffff" : s.textColor;
  const outline = seg.stroke || (luminance(fill) > 140 ? "#000000" : "#ffffff");
  const fontName = (seg.font || "").replace(/ Bold$/, "") || "Segoe UI";
  const bold = /Bold|Black|Impact/.test(seg.font || "") || !seg.font;
  const [, , bw, bh] = seg.box;
  const lines = Math.max(1, seg.lines || 1);
  const base = Math.max(10, Math.floor((bh / lines) * 0.85 * (seg.size_scale || 1)));
  const readable = Math.max(12, Math.floor(frameH * 0.022));
  div.style.fontFamily = `"${fontName}", "Segoe UI", sans-serif`;
  div.style.fontWeight = bold ? "700" : "400";
  div.style.color = fill;
  let size = 8;
  for (const [growW, growH] of [[1, 1], [1.35, 1.25], [1.7, 1.5]]) {
    div.style.width = `${bw * growW * k}px`;
    let lo = 8, hi = base;
    size = 8;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      div.style.fontSize = `${mid * k}px`;
      if (div.offsetHeight <= bh * growH * 1.05 * k + 1 && div.scrollWidth <= div.clientWidth + 1) {
        size = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (size >= Math.min(readable, base)) break;
  }
  div.style.fontSize = `${size * k}px`;
  const sw = seg.stroke_w == null ? Math.max(1, Math.floor(size / 12)) : (seg.stroke_w * size) / base;
  div.style.webkitTextStroke = sw > 0 ? `${2 * sw * k}px ${outline}` : "0";
}
function renderBoxes() {
  const overlay = $("overlay");
  const t = $("video").currentTime;
  const { w, h } = frameSize();
  overlay.querySelectorAll(".box").forEach((el) => el.remove());
  for (const seg of state.segments) {
    const active = t >= seg.start && t < seg.end;
    const selected = seg.id === state.selectedId;
    if (!active && !selected) continue;
    const [x, y, bw, bh] = seg.box;
    const el = document.createElement("div");
    el.className = "box" + (selected ? " sel" : "") + (!active ? " idle" : "") + (!seg.enabled ? " off" : "");
    el.dataset.id = seg.id;
    el.style.cssText = `left:${(x / w) * 100}%;top:${(y / h) * 100}%;width:${(bw / w) * 100}%;height:${(bh / h) * 100}%`;
    el.innerHTML = `<div class="txt${seg.text_vi ? "" : " dim"}">${esc(seg.text_vi || seg.text_zh || "(trống)")}</div>` + (selected ? '<span class="handle"></span>' : "");
    overlay.appendChild(el);
    styleOverlayText(el.firstChild, seg, overlay.clientWidth / w, w, h);
  }
}

function pointerToFrame(e) {
  const rect = $("overlay").getBoundingClientRect();
  const { w, h } = frameSize();
  return {
    x: Math.max(0, Math.min(w, ((e.clientX - rect.left) / rect.width) * w)),
    y: Math.max(0, Math.min(h, ((e.clientY - rect.top) / rect.height) * h)),
  };
}

$("overlay").addEventListener("pointerdown", (e) => {
  const boxEl = e.target.closest(".box");
  const start = pointerToFrame(e);
  const { w, h } = frameSize();

  if (state.drawMode && !boxEl) {
    $("overlay").setPointerCapture(e.pointerId);
    const draft = { id: nextId(), start: $("video").currentTime, end: Math.min(duration(), $("video").currentTime + 2),
      box: [start.x, start.y, 1, 1], lines: 1, color: "#ffffff", stroke: "", stroke_w: null, size_scale: 1, font: "", score: 1,
      text_zh: "", text_vi: "", enabled: true, manual: true };
    state.segments.push(draft);
    state.selectedId = draft.id;
    const move = (ev) => {
      const p = pointerToFrame(ev);
      draft.box = [Math.min(start.x, p.x), Math.min(start.y, p.y), Math.abs(p.x - start.x), Math.abs(p.y - start.y)];
      renderBoxes();
    };
    const up = () => {
      $("overlay").removeEventListener("pointermove", move);
      $("overlay").removeEventListener("pointerup", up);
      setDrawMode(false);
      if (draft.box[2] < 8 || draft.box[3] < 8) {
        state.segments = state.segments.filter((s) => s !== draft);
        state.selectedId = null;
        renderAll();
        return;
      }
      draft.box = draft.box.map(Math.round);
      renderAll();
      markDirty();
      autoOcrRegion(draft);
    };
    $("overlay").addEventListener("pointermove", move);
    $("overlay").addEventListener("pointerup", up);
    return;
  }
  if (!boxEl) return;

  const seg = segById(Number(boxEl.dataset.id));
  selectSeg(seg.id, { scroll: true });
  const resizing = e.target.classList.contains("handle");
  const origin = [...seg.box];
  $("overlay").setPointerCapture(e.pointerId);
  const move = (ev) => {
    const p = pointerToFrame(ev);
    if (resizing) {
      seg.box = [origin[0], origin[1], Math.max(8, Math.round(p.x - origin[0])), Math.max(8, Math.round(p.y - origin[1]))];
    } else {
      const nx = Math.max(0, Math.min(w - origin[2], origin[0] + p.x - start.x));
      const ny = Math.max(0, Math.min(h - origin[3], origin[1] + p.y - start.y));
      seg.box = [Math.round(nx), Math.round(ny), origin[2], origin[3]];
    }
    renderBoxes();
  };
  const up = () => {
    $("overlay").removeEventListener("pointermove", move);
    $("overlay").removeEventListener("pointerup", up);
    markDirty();
  };
  $("overlay").addEventListener("pointermove", move);
  $("overlay").addEventListener("pointerup", up);
});

function setDrawMode(on) {
  state.drawMode = on;
  $("overlay").classList.toggle("drawing", on);
  $("btnDraw").classList.toggle("on", on);
}

async function autoOcrRegion(seg) {
  const res = await runJob("ocr", {
    video: state.video, time: seg.start, box: seg.box, sample_fps: state.settings.sampleFps, device: state.settings.device, ...translateOptions(),
  }, "Đang nhận diện chữ trong vùng vừa chọn…");
  if (!res) return;
  Object.assign(seg, {
    text_zh: res.text_zh, text_vi: res.text_vi, start: res.start, end: res.end, lines: res.lines,
    color: res.color, stroke: res.stroke, stroke_w: res.stroke_w,
  });
  renderAll();
  markDirty();
}

// ---------- selection / timeline ----------
function selectSeg(id, { seek: doSeek = false, scroll = false } = {}) {
  state.selectedId = id;
  document.querySelectorAll(".row").forEach((r) => r.classList.toggle("sel", Number(r.dataset.id) === id));
  if (doSeek) {
    const seg = segById(id);
    if (seg) seek(seg.start + 0.001);
  }
  if (scroll) document.querySelector(`.row[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  renderBoxes();
  renderTimeline();
}

function renderTimeline() {
  const tl = $("timeline");
  tl.querySelectorAll(".tl-bar").forEach((el) => el.remove());
  const dur = duration() || 1;
  const laneEnds = [];
  const sorted = [...state.segments].sort((a, b) => a.start - b.start);
  for (const seg of sorted) {
    let lane = laneEnds.findIndex((end) => end <= seg.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = seg.end;
    const el = document.createElement("div");
    el.className = "tl-bar" + (seg.id === state.selectedId ? " sel" : "") + (!seg.enabled ? " off" : "");
    el.dataset.id = seg.id;
    el.title = `${seg.text_zh} → ${seg.text_vi}`;
    el.style.cssText = `left:${(seg.start / dur) * 100}%;width:${Math.max(0.3, ((seg.end - seg.start) / dur) * 100)}%;top:${6 + lane * 16}px`;
    tl.appendChild(el);
  }
  tl.style.height = `${Math.max(40, 12 + laneEnds.length * 16)}px`;
}

$("timeline").addEventListener("click", (e) => {
  const bar = e.target.closest(".tl-bar");
  if (bar) return selectSeg(Number(bar.dataset.id), { seek: true, scroll: true });
  const rect = $("timeline").getBoundingClientRect();
  seek(((e.clientX - rect.left) / rect.width) * duration());
});

// ---------- list ----------
function rowHtml(seg, index) {
  const warns = [];
  if (!seg.text_vi.trim()) warns.push("Chưa có bản dịch");
  if (seg.end <= seg.start) warns.push("Thời gian không hợp lệ");
  if (!seg.manual && seg.score < 0.75) warns.push(`OCR độ tin cậy thấp (${seg.score})`);
  return `
    <div class="row${seg.enabled ? "" : " disabled"}${seg.id === state.selectedId ? " sel" : ""}" data-id="${seg.id}">
      <div class="no" data-act="seek" title="Nhảy tới đoạn này">${index + 1}</div>
      <div class="body">
        <div class="times">
          <label><input type="checkbox" data-field="enabled" ${seg.enabled ? "checked" : ""}> Áp dụng</label>
          <input type="number" step="0.01" min="0" data-field="start" value="${seg.start}" title="Bắt đầu (giây)">
          <button class="small" data-act="setStart" title="Đặt = thời điểm hiện tại">⟲</button>
          <span>→</span>
          <input type="number" step="0.01" min="0" data-field="end" value="${seg.end}" title="Kết thúc (giây)">
          <button class="small" data-act="setEnd" title="Đặt = thời điểm hiện tại">⟲</button>
          <span class="muted mono">${(seg.end - seg.start).toFixed(2)}s</span>
        </div>
        <input class="zh" data-field="text_zh" value="${esc(seg.text_zh)}" placeholder="Văn bản gốc">
        <textarea data-field="text_vi" placeholder="Bản dịch">${esc(seg.text_vi)}</textarea>
        <div class="style">
          <label>Màu chữ <input type="color" data-field="color" value="${seg.color || "#ffffff"}"></label>
          <label>Màu viền <input type="color" data-field="stroke" value="${seg.stroke || "#000000"}"></label>
          <label>Dày viền <input type="number" min="0" max="30" step="0.5" data-field="stroke_w" value="${seg.stroke_w ?? ""}" placeholder="auto"></label>
          <label>Cỡ chữ % <input type="number" min="30" max="400" step="5" data-field="size_pct" value="${Math.round((seg.size_scale || 1) * 100)}"></label>
          <label>Font <select data-field="font"><option value="">Mặc định</option>${state.fonts.map((f) => `<option${f === seg.font ? " selected" : ""}>${esc(f)}</option>`).join("")}</select></label>
        </div>
        ${warns.length ? `<div class="warn">⚠ ${warns.join(" · ")}</div>` : ""}
        <div class="actions">
          <button data-act="seek">▶ Xem</button>
          <button data-act="retranslate">🌐 Dịch lại</button>
          <button data-act="mergeBelow" title="Gộp với đoạn nằm ngay bên dưới (cùng thời điểm)">⤓ Gộp dòng dưới</button>
          <button data-act="delete" class="danger">🗑 Xoá</button>
        </div>
      </div>
    </div>`;
}

function renderList() {
  const q = $("filter").value.trim().toLowerCase();
  const sorted = [...state.segments].sort((a, b) => a.start - b.start || a.id - b.id);
  const html = sorted
    .map((seg, i) => ({ seg, i }))
    .filter(({ seg }) => !q || seg.text_zh.toLowerCase().includes(q) || seg.text_vi.toLowerCase().includes(q))
    .map(({ seg, i }) => rowHtml(seg, i))
    .join("");
  $("list").innerHTML = html || '<p class="muted">Chưa có đoạn nào. Bấm “Phân tích &amp; dịch”.</p>';
  $("count").textContent = `${state.segments.filter((s) => s.enabled).length}/${state.segments.length} đoạn`;
  state.activeSig = "";
}

function renderAll() {
  renderList();
  renderBoxes();
  renderTimeline();
  refreshButtons();
  tick(true);
}

$("list").addEventListener("input", (e) => {
  const field = e.target.dataset.field;
  if (!field) return;
  const seg = segById(Number(e.target.closest(".row").dataset.id));
  if (field === "enabled") {
    seg.enabled = e.target.checked;
    e.target.closest(".row").classList.toggle("disabled", !seg.enabled);
    renderTimeline();
  } else if (field === "start" || field === "end") {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v)) seg[field] = v;
  } else if (field === "size_pct") {
    const v = parseFloat(e.target.value);
    if (v > 0) seg.size_scale = v / 100;
  } else if (field === "stroke_w") {
    const v = parseFloat(e.target.value);
    seg.stroke_w = Number.isFinite(v) ? v : null;
  } else {
    seg[field] = e.target.value;
  }
  renderBoxes();
  markDirty();
});

$("list").addEventListener("change", (e) => {
  if (e.target.dataset.field === "start" || e.target.dataset.field === "end") renderAll();
});

$("list").addEventListener("focusin", (e) => {
  const row = e.target.closest(".row");
  if (row && Number(row.dataset.id) !== state.selectedId) selectSeg(Number(row.dataset.id));
});

$("list").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const seg = segById(Number(btn.closest(".row").dataset.id));
  const act = btn.dataset.act;
  if (act === "seek") selectSeg(seg.id, { seek: true });
  else if (act === "setStart") { seg.start = +$("video").currentTime.toFixed(3); renderAll(); markDirty(); }
  else if (act === "setEnd") { seg.end = +$("video").currentTime.toFixed(3); renderAll(); markDirty(); }
  else if (act === "delete") {
    state.segments = state.segments.filter((s) => s !== seg);
    if (state.selectedId === seg.id) state.selectedId = null;
    renderAll();
    markDirty();
  } else if (act === "retranslate") await retranslate([seg]);
  else if (act === "mergeBelow") await mergeBelow(seg);
});

async function mergeBelow(seg) {
  const [ax, ay, aw, ah] = seg.box;
  const below = state.segments
    .filter((o) => o !== seg && o.start < seg.end && o.end > seg.start && o.box[1] >= ay)
    .sort((p, q) => p.box[1] - q.box[1])[0];
  if (!below) return alert("Không có đoạn nào nằm bên dưới và cùng thời điểm với đoạn này.");
  const [bx, by, bw, bh] = below.box;
  const x0 = Math.min(ax, bx), y0 = Math.min(ay, by);
  seg.box = [x0, y0, Math.max(ax + aw, bx + bw) - x0, Math.max(ay + ah, by + bh) - y0];
  seg.lines = (seg.lines || 1) + (below.lines || 1);
  seg.text_zh = `${seg.text_zh} ${below.text_zh}`.trim();
  seg.start = Math.min(seg.start, below.start);
  seg.end = Math.max(seg.end, below.end);
  state.segments = state.segments.filter((o) => o !== below);
  renderAll();
  await retranslate([seg]);
}

async function retranslate(segs) {
  const targets = segs.filter((s) => s.text_zh.trim());
  if (!targets.length) return;
  const res = await runJob("translate", { texts: targets.map((s) => s.text_zh), ...translateOptions() }, "Đang dịch…");
  if (!res) return;
  targets.forEach((s, i) => (s.text_vi = res.texts[i]));
  renderAll();
  markDirty();
}

$("filter").addEventListener("input", renderList);
$("btnRetransEmpty").addEventListener("click", () => retranslate(state.segments.filter((s) => !s.text_vi.trim())));
$("btnRetransAll").addEventListener("click", () => {
  if (confirm("Dịch lại toàn bộ sẽ ghi đè các chỉnh sửa bản dịch của bạn. Tiếp tục?")) retranslate(state.segments);
});
$("btnReplace").addEventListener("click", () => {
  const find = $("findText").value;
  if (!find) return;
  let n = 0;
  for (const seg of state.segments) {
    const parts = seg.text_vi.split(find);
    if (parts.length > 1) { n += parts.length - 1; seg.text_vi = parts.join($("replaceText").value); }
  }
  alert(`Đã thay ${n} chỗ.`);
  renderAll();
  markDirty();
});

// ---------- playback ----------
function tick(force = false) {
  const video = $("video");
  const t = video.currentTime;
  if (force || t !== state.lastTime) {
    state.lastTime = t;
    $("timeLabel").textContent = fmtTime(t);
    const dur = duration() || 1;
    if (document.activeElement !== $("seek")) $("seek").value = Math.round((t / dur) * 1000);
    $("playhead").style.left = `${(t / dur) * 100}%`;
    const sig = activeSegments(t).map((s) => s.id).join(",");
    if (force || sig !== state.activeSig) {
      state.activeSig = sig;
      const active = new Set(sig ? sig.split(",").map(Number) : []);
      document.querySelectorAll(".row").forEach((r) => r.classList.toggle("active", active.has(Number(r.dataset.id))));
      renderBoxes();
    }
  }
  $("btnPlay").textContent = video.paused ? "▶" : "⏸";
}

(function loop() {
  if (state.video) tick();
  requestAnimationFrame(loop);
})();

$("btnPlay").addEventListener("click", () => ($("video").paused ? $("video").play() : $("video").pause()));
$("btnPrev").addEventListener("click", () => { $("video").pause(); seek($("video").currentTime - 1 / fps()); });
$("btnNext").addEventListener("click", () => { $("video").pause(); seek($("video").currentTime + 1 / fps()); });
$("seek").addEventListener("input", () => seek(($("seek").value / 1000) * duration()));
$("btnDraw").addEventListener("click", () => { $("video").pause(); setDrawMode(!state.drawMode); });

document.addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    markDirty();
  } else if (!typing && state.video) {
    if (e.code === "Space") { e.preventDefault(); $("btnPlay").click(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); seek($("video").currentTime - (e.shiftKey ? 1 : 1 / fps())); }
    else if (e.key === "ArrowRight") { e.preventDefault(); seek($("video").currentTime + (e.shiftKey ? 1 : 1 / fps())); }
    else if (e.key === "Escape") setDrawMode(false);
  }
});

// ---------- main actions ----------
$("btnOpen").addEventListener("click", async () => {
  try {
    await openVideo(await window.api.openVideo());
  } catch (err) {
    alert(`Không mở được video: ${err.message}`);
  }
});

["dragover", "dragleave", "drop"].forEach((type) =>
  document.addEventListener(type, (e) => {
    e.preventDefault();
    $("empty").classList.toggle("drag", type === "dragover");
    if (type === "drop" && !state.busy && e.dataTransfer.files[0]) openVideo(window.api.pathOfFile(e.dataTransfer.files[0]));
  }));

$("btnAnalyze").addEventListener("click", async () => {
  if (state.segments.length && !confirm("Phân tích lại sẽ thay thế toàn bộ danh sách hiện tại (kể cả chỉnh sửa). Tiếp tục?")) return;
  const s = state.settings;
  const res = await runJob("analyze", {
    video: state.video, sample_fps: s.sampleFps, min_score: s.minScore, only_cjk: s.onlyCjk, device: s.device, merge: s.merge, ...translateOptions(),
  }, "Đang phân tích video…");
  if (!res) return;
  state.info = { ...state.info, ...res.video };
  state.segments = res.segments;
  state.selectedId = null;
  renderAll();
  markDirty();
  if (res.translate_errors) alert(`${res.translate_errors} đoạn chưa dịch được (lỗi mạng/giới hạn dịch). Bấm “Dịch dòng trống” để thử lại.`);
  else if (!res.segments.length) alert("Không tìm thấy chữ Trung nào. Thử hạ “Ngưỡng tin cậy OCR” trong Cài đặt hoặc thêm vùng thủ công.");
});

$("btnPreview").addEventListener("click", async () => {
  $("video").pause();
  const output = await window.api.previewPath();
  const res = await runJob("preview", {
    video: state.video, time: $("video").currentTime, segments: state.segments, style: styleSettings(), output,
  }, "Đang dựng khung hình xem thử…");
  if (!res) return;
  $("previewImg").src = fileUrl(output) + "?t=" + Date.now();
  $("previewImg").classList.remove("hidden");
  $("btnClosePreview").classList.remove("hidden");
});

$("btnClosePreview").addEventListener("click", () => {
  $("previewImg").classList.add("hidden");
  $("btnClosePreview").classList.add("hidden");
});

$("btnApply").addEventListener("click", async () => {
  const enabled = state.segments.filter((s) => s.enabled);
  if (!enabled.length) return alert("Chưa có đoạn nào được bật “Áp dụng”.");
  const empty = enabled.filter((s) => !s.text_vi.trim()).length;
  if (empty && !confirm(`${empty} đoạn đang bật nhưng chưa có bản dịch: chữ gốc sẽ bị xoá và không có chữ thay thế. Tiếp tục?`)) return;

  const base = state.video.replace(/\.[^.]+$/, "");
  const output = await window.api.saveVideo(`${base}_${state.settings.target}.mp4`);
  if (!output) return;
  const res = await runJob("render", {
    video: state.video, segments: state.segments, style: styleSettings(), output,
    crf: state.settings.crf, preset: state.settings.preset, encoder: state.settings.encoder,
  }, "Đang ghi đè text và xuất video…");
  if (res && confirm("Xuất video xong! Mở thư mục chứa file?")) window.api.reveal(output);
});

$("btnCancel").addEventListener("click", () => window.api.cancel());

// ---------- video preview ----------
$("btnPreviewVideo").addEventListener("click", () => {
  $("video").pause();
  $("pvStart").value = $("video").currentTime.toFixed(1);
  $("pvDialog").showModal();
});

$("pvAll").addEventListener("change", () => {
  $("pvStart").disabled = $("pvLen").disabled = $("pvAll").checked;
});

$("pvBuild").addEventListener("click", async () => {
  const pv = $("pvVideo");
  pv.removeAttribute("src");
  pv.load(); // release the previous clip so ffmpeg can overwrite it
  const output = (await window.api.previewPath()).replace(/preview\.png$/, "preview.mp4");
  const whole = $("pvAll").checked;
  const res = await runJob("render", {
    video: state.video, segments: state.segments, style: styleSettings(), output,
    start: whole ? 0 : parseFloat($("pvStart").value) || 0, duration: whole ? null : parseFloat($("pvLen").value) || 10,
    scale_height: 540, crf: 28, preset: "veryfast", encoder: state.settings.encoder,
  }, "Đang dựng bản xem thử…");
  if (!res) return;
  pv.src = fileUrl(output) + "?t=" + Date.now();
  pv.play();
});

$("pvCancel").addEventListener("click", () => window.api.cancel());
$("pvDialog").addEventListener("close", () => $("pvVideo").pause());

// ---------- settings ----------
const FIELDS = {
  source: "setSource", target: "setTarget", engine: "setEngine", sampleFps: "setSampleFps", minScore: "setMinScore",
  eraseMode: "setErase", textColor: "setTextColor", font: "setFont", crf: "setCrf", preset: "setPreset", glossary: "setGlossary", device: "setDevice", encoder: "setEncoder", merge: "setMerge",
};

function fillSettingsForm() {
  for (const [key, id] of Object.entries(FIELDS)) $(id).value = state.settings[key];
  $("setOnlyCjk").checked = state.settings.onlyCjk;
}

$("btnSettings").addEventListener("click", () => { fillSettingsForm(); $("settingsDialog").showModal(); });

function markOption(selectId, value, available) {
  const opt = $(selectId).querySelector(`option[value="${value}"]`);
  opt.textContent = opt.textContent.replace(/ \(chưa có\)$/, "") + (available ? "" : " (chưa có)");
}

$("btnDevices").addEventListener("click", async () => {
  $("devHint").textContent = "Đang kiểm tra…";
  const res = await runJob("devices", {}, "Đang kiểm tra thiết bị…");
  if (!res) return ($("devHint").textContent = "");
  markOption("setDevice", "cuda", res.ocr.cuda);
  markOption("setDevice", "dml", res.ocr.dml);
  for (const enc of ["h264_nvenc", "h264_qsv", "h264_amf"]) markOption("setEncoder", enc, res.encoders.includes(enc));
  $("devHint").textContent = res.ocr.cuda || res.ocr.dml
    ? `OCR GPU khả dụng: ${[res.ocr.cuda && "CUDA", res.ocr.dml && "DirectML"].filter(Boolean).join(", ")}.`
    : "OCR chỉ có CPU. Chạy setup-gpu.bat để cài bản GPU. Encoder GPU còn tuỳ card; nếu không chạy được sẽ tự dùng CPU.";
});
$("btnFont").addEventListener("click", async () => { const f = await window.api.pickFont(); if (f) $("setFont").value = f; });
$("btnFontClear").addEventListener("click", () => ($("setFont").value = ""));
$("settingsDialog").addEventListener("close", async () => {
  if ($("settingsDialog").returnValue !== "ok") return;
  for (const [key, id] of Object.entries(FIELDS)) {
    const el = $(id);
    state.settings[key] = el.type === "number" ? parseFloat(el.value) || DEFAULTS[key] : el.value;
  }
  state.settings.onlyCjk = $("setOnlyCjk").checked;
  await window.api.saveSettings(state.settings);
});

(async function init() {
  const saved = await window.api.loadSettings();
  if (saved) state.settings = { ...DEFAULTS, ...saved };
  refreshButtons();
  const dev = await window.api.run("devices", {});
  if (dev.ok) state.fonts = dev.result.fonts;
})();
