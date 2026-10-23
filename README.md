# Video Text Translator

Desktop app (Electron + Python) that finds hard-coded Chinese text in a video, works out where and how long each
caption is on screen, translates it, lets you edit the translations, then erases the original text and draws the
translation in its place.

## Setup (Windows)

Requires Python 3.10+, Node.js and FFmpeg on `PATH`.

```bash
setup.bat
npm start
```

## Workflow

1. **Mở video** (or drag & drop). A previous project (`<video>.vtproj.json`) is loaded automatically if present.
2. **Phân tích & dịch**: samples frames (default 2/s), OCRs Chinese text, groups lines into captions, tracks each
   caption across frames, refines start/end to the exact frame, then translates.
3. Review the list: edit translation / source text / start-end time / box position on the video, toggle **Áp dụng**,
   delete false positives, or **➕ Thêm vùng** to draw a box over missed text (it is OCR'd, translated and timed
   automatically). Edits autosave.
4. **Xem thử khung hình** renders the current frame with the real erase + overlay.
5. **Xem thử video** renders a light 540p clip (a chosen range or the whole video) with the real erase + overlay so
   timing and placement can be checked while playing.
6. **Apply & xuất video** re-encodes the video (H.264, audio re-encoded to AAC) with the original text erased and the
   translation drawn.

## GPU (optional)

Default is CPU. In **Cài đặt** pick the OCR device (Auto / CPU / CUDA / DirectML) and the video encoder
(libx264 / NVENC / QuickSync / AMF), and press **Kiểm tra GPU**. For OCR on GPU run `setup-gpu.bat` once
(`onnxruntime-gpu` for NVIDIA CUDA, or `onnxruntime-directml` for any DirectX 12 GPU). If the chosen device or
encoder is unavailable the app falls back to CPU and says so. GPU paths are untested on the dev machine (no GPU).

## Free components

| Task | Library |
|---|---|
| OCR (Chinese) | RapidOCR (PaddleOCR models on ONNX Runtime, CPU) |
| Translation | deep-translator: Google (unofficial) with automatic fallback to MyMemory |
| Erase text | OpenCV inpaint on a stroke mask |
| Video I/O | OpenCV + FFmpeg |

## Backend CLI

`backend/vt` is driven by JSON config files and prints JSON lines on stdout:

```bash
cd backend
.venv\Scripts\python -m vt.cli analyze --config cfg.json
```

Commands: `analyze`, `ocr`, `translate`, `preview`, `render`.

## Known limits

- Text that moves or scrolls across the screen is tracked as a static box.
- Vertical or heavily rotated text is boxed axis-aligned.
- OCR can miss low-contrast or stylised text; use the manual region tool.
- Google's unofficial endpoint can block an IP (HTTP 429 / captcha); MyMemory is then used automatically
  and has a daily anonymous quota.
