"""Character set for the CRNN+CTC OCR model.

Convention shared with the TypeScript OnnxEngine (src/main/ocr/onnxEngine.ts):
  - index 0 is the CTC BLANK token (stored as "<blank>")
  - indices 1..N are the real characters
  - charset.json is written next to model.onnx so inference uses the SAME mapping

Build the charset from the training labels so it always covers what we render.
"""
import json
import os

BLANK = "<blank>"


def build_charset(texts):
    """Collect every character that appears in the labels (newlines excluded)."""
    chars = set()
    for t in texts:
        for ch in t:
            if ch != "\n":
                chars.add(ch)
    ordered = [BLANK] + sorted(chars)
    return ordered


def save_charset(chars, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"chars": chars}, f, ensure_ascii=False, indent=2)


def load_charset(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)["chars"]


class Charset:
    def __init__(self, chars):
        self.chars = chars
        self.stoi = {c: i for i, c in enumerate(chars)}

    def __len__(self):
        return len(self.chars)

    def encode(self, text):
        """Text -> list of class indices (unknown chars skipped)."""
        return [self.stoi[c] for c in text if c in self.stoi and c != "\n"]

    def decode_indices(self, indices):
        """Raw index list -> string (no CTC collapse; that's in decode.py)."""
        return "".join(self.chars[i] for i in indices if 0 <= i < len(self.chars))

    @classmethod
    def from_file(cls, path):
        return cls(load_charset(path))


if __name__ == "__main__":
    # Quick CLI: build a charset.json from a labels.jsonl
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("labels")
    ap.add_argument("out")
    args = ap.parse_args()
    texts = []
    with open(args.labels, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                texts.append(json.loads(line)["text"])
    cs = build_charset(texts)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    save_charset(cs, args.out)
    print(f"charset: {len(cs)} classes (incl. blank) -> {args.out}")
