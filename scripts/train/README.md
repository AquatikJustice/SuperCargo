# SuperCargo custom OCR - CRNN+CTC training

**Full workflow lives in [`docs/OCR-TRAINING.md`](../../docs/OCR-TRAINING.md).** Read that.

Quick reference (from this folder, with the venv active):

```bash
# 0. setup (once): install torch for your hardware, then:
pip install -r requirements.txt

# 1. generate data (from repo root): npm run gen:training -- --count 20000 --out training-data
# 2. train
python train.py --data ../../training-data --out ../../models/crnn --epochs 30
# 3. export
python export_onnx.py --model ../../models/crnn/crnn.pt
# 4. deploy: copy model.onnx + charset.json to %APPDATA%\supercargo\ocr-model\, pick "Custom (ONNX)" in Settings
```

Trainer <-> app contract (don't break): input `[1,1,32,W]`, normalize `(x/255-0.5)/0.5`,
output `[1,T,C]`, CTC blank = index 0, charset `{ "chars": ["<blank>", ...] }`. Mirror any
change in `src/main/ocr/onnxEngine.ts`.
