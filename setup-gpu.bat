@echo off
cd /d "%~dp0"
echo Chon ban onnxruntime cho OCR bang GPU:
echo   1 = NVIDIA CUDA (can driver + CUDA/cuDNN phu hop)
echo   2 = DirectML (moi GPU Windows DirectX 12: NVIDIA, AMD, Intel)
echo   0 = Quay ve CPU
set /p choice=Chon: 
backend\.venv\Scripts\python -m pip uninstall -y onnxruntime onnxruntime-gpu onnxruntime-directml
if "%choice%"=="1" backend\.venv\Scripts\python -m pip install onnxruntime-gpu
if "%choice%"=="2" backend\.venv\Scripts\python -m pip install onnxruntime-directml
if "%choice%"=="0" backend\.venv\Scripts\python -m pip install onnxruntime
echo Xong. Mo app, vao Cai dat bam "Kiem tra GPU".
