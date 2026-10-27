# 🎬 Video Text Translator

**Video Text Translator** is a Windows desktop application built with **Electron + Python** that detects hard-coded Chinese text in videos, translates it, removes the original text, and renders the translated captions in their place.

It combines OCR, caption timing, manual editing, text removal, and video export in one workflow.

## ✨ Features

- **Automatic Chinese text detection** using OCR on sampled video frames (default: 2 frames/second).
- **Caption tracking and timing**: groups detected lines into captions, tracks them across frames, and refines their start and end times to individual frames.
- **Automatic translation** with Google via `deep-translator`, falling back to MyMemory when needed.
- **Editable results**: adjust source text, translations, timestamps, and on-screen bounding boxes.
- **Manual region selection** for captions missed by OCR; the selected area is OCR'd, translated, and timed automatically.
- **Autosaved projects** using `<video>.vtproj.json`.
- **Frame and video previews** showing the actual text removal and translated overlay.
- **Video export** with H.264 video and AAC audio.
- **Optional GPU acceleration** for OCR and video encoding, with CPU fallback when unavailable.

## 🛠️ Tech Stack

| Component | Technology |
| --- | --- |
| Desktop interface | Electron |
| Backend | Python 3.10+ |
| Chinese OCR | RapidOCR (PaddleOCR ONNX models) |
| Translation | `deep-translator` (Google, fallback to MyMemory) |
| Text removal | OpenCV inpainting with a stroke mask |
| Video processing | OpenCV + FFmpeg |
| OCR inference | ONNX Runtime |

## 📋 Requirements

- **Windows**
- **Python 3.10+**
- **Node.js** and npm
- **FFmpeg** installed and available on your system `PATH`

Verify the tools are available:

```powershell
python --version
node --version
npm --version
ffmpeg -version
```

## 🚀 Installation

Open a terminal in the project directory and run:

```bat
setup.bat
npm start
```

`setup.bat` prepares the local application environment. `npm start` launches the desktop app.

> **Note:** This project is a desktop application, not a browser-based service. Consult the repository's setup scripts for the exact packages installed.

## 🎞️ How to Use

1. **Open a video** using **Mở video** or drag and drop a file. If `<video>.vtproj.json` exists, the previous project is loaded automatically.
2. Click **Phân tích & dịch** to sample frames, detect Chinese text, group and track captions, refine timing, and translate the results.
3. **Review and edit captions**: change the source text, translation, start/end times, or bounding box. Toggle **Áp dụng** to include or exclude a caption, or delete false positives. Changes are autosaved.
4. Use **➕ Thêm vùng** to draw a box around missed text. The app automatically detects, translates, and times the selected region.
5. Click **Xem thử khung hình** to preview text removal and the translated overlay on the current frame.
6. Click **Xem thử video** to generate a lightweight **540p** preview for a selected range or the whole video.
7. Click **Apply & xuất video** to export the processed video with original text removed and translations rendered in place.

### Processing Pipeline

```text
Input video
    ↓
Sample frames (default: 2 FPS)
    ↓
Chinese OCR
    ↓
Group captions and track their visibility
    ↓
Refine start/end times to exact frames
    ↓
Translate text
    ↓
Review, edit, and preview
    ↓
Remove original text (OpenCV inpaint)
    ↓
Draw translated text
    ↓
Export H.264 video + AAC audio
```

## 💾 Project Files

Edits are autosaved to a project file named after the source video:

```text
example.mp4
example.mp4.vtproj.json
```

Opening the same video again automatically restores its project when that file is present.

## ⚡ Optional GPU Acceleration

The app runs on **CPU by default**. Under **Cài đặt**, choose:

| Setting | Available options |
| --- | --- |
| OCR device | Auto / CPU / CUDA / DirectML |
| Video encoder | libx264 / NVENC / QuickSync / AMF |

Click **Kiểm tra GPU** to check available hardware acceleration.

For GPU OCR, run the optional setup script once:

```bat
setup-gpu.bat
```

The relevant runtime depends on your hardware:

- **NVIDIA CUDA:** `onnxruntime-gpu`
- **DirectX 12 GPU:** `onnxruntime-directml`

If the requested device or encoder is unavailable, the application falls back to CPU and reports the fallback.

> **GPU testing status:** GPU execution paths have not been validated on the original development machine because it did not have a GPU. Test your device and encoder combination before processing long videos.

## 🧰 Backend CLI

The Python backend is available through `vt.cli`. Commands read JSON configuration files and emit JSON Lines on standard output.

Example (Windows):

```bat
cd backend
.venv\Scripts\python -m vt.cli analyze --config cfg.json
```

Available commands:

| Command | Purpose |
| --- | --- |
| `analyze` | Analyze video text and captions |
| `ocr` | Run text recognition |
| `translate` | Translate detected text |
| `preview` | Generate previews |
| `render` | Render the processed video |

> Configuration schemas and command-specific options are defined by the backend implementation; the example above only demonstrates the documented `analyze` invocation.

## ⚠️ Known Limitations

- **Moving or scrolling captions:** text is tracked using a static bounding box rather than a moving region.
- **Vertical or rotated text:** bounding boxes remain axis-aligned.
- **Low-contrast or stylized text:** OCR may miss some captions; use **➕ Thêm vùng** to add them manually.
- **Translation availability:** the unofficial Google translation endpoint may respond with HTTP 429 or CAPTCHA challenges. The app falls back to MyMemory, which has a daily anonymous usage quota.
- **Inpainting quality:** removing text over complex or changing backgrounds may leave visible artifacts. Check the previews before exporting.
- **GPU compatibility:** acceleration depends on installed drivers, runtime support, and available encoders.

## 🔧 Troubleshooting

**`python`, `node`, or `ffmpeg` is not recognized**  
Install the missing dependency and ensure it is available on `PATH`. Restart your terminal afterward.

**OCR misses text**  
Try manually adding a region with **➕ Thêm vùng**, then review the detected text and timing.

**Translations fail or become rate-limited**  
The Google endpoint may be unavailable or rate-limited. MyMemory fallback also has usage limits; retry later if both providers are unavailable.

**GPU processing does not start**  
Use **Kiểm tra GPU**, verify your drivers and runtime, or select CPU / `libx264`.

**Captions appear at the wrong time or position**  
Edit the start/end timestamps and bounding box, then validate using frame and video previews.

## 🔒 Privacy & Responsible Use

Video processing runs through the local desktop application, but **automatic translation uses external translation services**. Text submitted for translation may be sent to those providers. Review their privacy terms before processing sensitive material.

Only process and publish videos you have the rights or permission to modify. Review translations and visual output before distribution.

## 📄 License

No license is specified in the provided project details. Add a `LICENSE` file if you intend to publish the repository with explicit reuse and contribution permissions.

---

**Video Text Translator** — Detect · Translate · Edit · Remove · Render
