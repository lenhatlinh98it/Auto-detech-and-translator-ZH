import subprocess

import onnxruntime as ort

import os

from .util import FONT_DIR, FONT_PRESETS, emit

OCR_FLAGS = {"cuda": "EngineConfig.onnxruntime.use_cuda", "dml": "EngineConfig.onnxruntime.use_dml"}
ENCODER_NAMES = ("libx264", "h264_nvenc", "h264_qsv", "h264_amf")


def available_ocr():
    providers = ort.get_available_providers()
    return {"cuda": "CUDAExecutionProvider" in providers, "dml": "DmlExecutionProvider" in providers}


def ocr_params(device):
    """Map the user's device choice (auto/cpu/cuda/dml) to RapidOCR params, falling back to CPU."""
    av = available_ocr()
    if device in (None, "auto"):
        device = "cuda" if av["cuda"] else "dml" if av["dml"] else "cpu"
    elif device in av and not av[device]:
        emit(type="warn", message=f"OCR device '{device}' is not available (onnxruntime GPU package missing); using CPU")
        device = "cpu"
    return ({OCR_FLAGS[device]: True} if device in OCR_FLAGS else {}), device


def list_devices(cfg):
    out = subprocess.run([cfg.get("ffmpeg", "ffmpeg"), "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    emit(type="result", ocr=available_ocr(), providers=ort.get_available_providers(),
         encoders=[name for name in ENCODER_NAMES if name in out],
         fonts=[n for n, f in FONT_PRESETS.items() if os.path.isfile(FONT_DIR + f)])
