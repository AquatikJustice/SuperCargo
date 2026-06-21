"""Sanity-check an exported ONNX model on a single image (matches onnxEngine.ts).

  python infer.py --model ../../models/crnn/model.onnx --image line.png
"""
import argparse
import os

import numpy as np
import onnxruntime as ort
from PIL import Image

from charset import load_charset
from dataset import preprocess
from decode import greedy_decode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--charset", help="defaults to charset.json beside --model")
    ap.add_argument("--image", required=True)
    args = ap.parse_args()

    charset_path = args.charset or os.path.join(os.path.dirname(os.path.abspath(args.model)), "charset.json")
    chars = load_charset(charset_path)

    arr = preprocess(Image.open(args.image))[None, :, :, :].astype(np.float32)  # [1,1,32,W]
    sess = ort.InferenceSession(args.model, providers=["CPUExecutionProvider"])
    logits = sess.run(None, {"input": arr})[0]  # [1, T, C]
    idx = logits[0].argmax(axis=1).tolist()
    print(greedy_decode(idx, chars))


if __name__ == "__main__":
    main()
