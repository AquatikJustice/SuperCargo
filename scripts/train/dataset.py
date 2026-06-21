"""Dataset for the synthetic (and harvested) OCR line images.

Reads a labels.jsonl produced by scripts/gen-training-data.mjs:
  { "id", "image": "images/<id>.png", "text": "...", ... }

Each line image is grayscale, resized to a fixed height (IMG_H), normalized to
[-1, 1] (dark background -> ~-1, bright text -> ~+1). Multi-line labels (the
"panel" template) are flattened to a single line with a space, matching how a
single recognized strip would read; for best results train mostly on single
lines. The TS OnnxEngine uses the identical preprocessing.
"""
import json
import os

import numpy as np
import torch
from PIL import Image
from torch.utils.data import Dataset

IMG_H = 32  # model input height (shared with onnxEngine.ts)
PAD_VALUE = -1.0  # dark-background pad after normalization


def preprocess(pil_img, img_h=IMG_H):
    """PIL image -> float32 numpy [1, H, W] normalized to [-1, 1]."""
    g = pil_img.convert("L")
    w, h = g.size
    new_w = max(1, round(w * img_h / h))
    g = g.resize((new_w, img_h), Image.BILINEAR)
    arr = np.asarray(g, dtype=np.float32) / 255.0
    arr = (arr - 0.5) / 0.5
    return arr[None, :, :]  # [1, H, W]


class OcrLineDataset(Dataset):
    def __init__(self, root, charset, img_h=IMG_H):
        self.root = root
        self.charset = charset
        self.img_h = img_h
        self.items = []
        with open(os.path.join(root, "labels.jsonl"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                text = rec["text"].replace("\n", " ").strip()
                if text:
                    self.items.append((rec["image"], text))

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        rel, text = self.items[i]
        img = Image.open(os.path.join(self.root, rel))
        arr = preprocess(img, self.img_h)
        target = self.charset.encode(text)
        return torch.from_numpy(arr), torch.tensor(target, dtype=torch.long), text


def collate(batch):
    """Right-pad images to the batch's max width; concat CTC targets."""
    imgs, targets, texts = zip(*batch)
    max_w = max(im.shape[2] for im in imgs)
    out = torch.full((len(imgs), 1, IMG_H, max_w), PAD_VALUE, dtype=torch.float32)
    for i, im in enumerate(imgs):
        out[i, :, :, : im.shape[2]] = im
    target_lengths = torch.tensor([len(t) for t in targets], dtype=torch.long)
    targets_cat = torch.cat(targets) if targets else torch.tensor([], dtype=torch.long)
    return out, targets_cat, target_lengths, list(texts)
