"""Export a trained CRNN checkpoint to ONNX for the app's OnnxEngine.

  python export_onnx.py --model ../../models/crnn/crnn.pt --out ../../models/crnn/model.onnx

Produces model.onnx (dynamic batch + width) and copies charset.json beside it.
Deploy both to  %APPDATA%/supercargo/ocr-model/  then set OCR engine = "onnx".
"""
import argparse
import os
import shutil

import torch

from model import CRNN


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="crnn.pt checkpoint")
    ap.add_argument("--charset", help="charset.json (defaults to alongside --model)")
    ap.add_argument("--out", help="output model.onnx (defaults to alongside --model)")
    ap.add_argument("--opset", type=int, default=13)
    args = ap.parse_args()

    model_dir = os.path.dirname(os.path.abspath(args.model))
    charset_path = args.charset or os.path.join(model_dir, "charset.json")
    out = args.out or os.path.join(model_dir, "model.onnx")

    ckpt = torch.load(args.model, map_location="cpu")
    model = CRNN(ckpt["num_classes"])
    model.load_state_dict(ckpt["state_dict"])
    model.eval()

    dummy = torch.randn(1, 1, 32, 256)
    torch.onnx.export(
        model, dummy, out,
        input_names=["input"], output_names=["logits"],
        dynamic_axes={"input": {0: "batch", 3: "width"}, "logits": {0: "batch", 1: "time"}},
        opset_version=args.opset,
    )
    print(f"exported -> {out}")

    # copy charset next to the model so inference uses the same mapping
    dst_charset = os.path.join(os.path.dirname(os.path.abspath(out)), "charset.json")
    if os.path.abspath(charset_path) != os.path.abspath(dst_charset):
        shutil.copyfile(charset_path, dst_charset)
    print(f"charset  -> {dst_charset}")

    # sanity check with onnxruntime if available
    try:
        import onnxruntime as ort

        sess = ort.InferenceSession(out, providers=["CPUExecutionProvider"])
        o = sess.run(None, {"input": dummy.numpy()})[0]
        print(f"onnxruntime OK - output shape {o.shape} (batch, time, classes)")
    except Exception as e:  # noqa: BLE001
        print(f"(skipped ORT verify: {e})")


if __name__ == "__main__":
    main()
