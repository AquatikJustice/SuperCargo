"""Train the CRNN+CTC line recognizer on generated/harvested OCR data.

  python train.py --data ../../training-data --out ../../models/crnn --epochs 30

Writes <out>/crnn.pt (best by val CER) and <out>/charset.json. Then run
export_onnx.py to produce model.onnx for the app's OnnxEngine.
"""
import argparse
import json
import os

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader, random_split

from charset import Charset, build_charset, save_charset
from dataset import OcrLineDataset, collate
from decode import cer, greedy_decode
from model import CRNN


def load_texts(root):
    texts = []
    with open(os.path.join(root, "labels.jsonl"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                texts.append(json.loads(line)["text"].replace("\n", " ").strip())
    return texts


def evaluate(model, loader, charset, device):
    model.eval()
    exact, total, cer_sum = 0, 0, 0.0
    with torch.no_grad():
        for imgs, _, _, texts in loader:
            logits = model(imgs.to(device))           # [B, T, C]
            preds = logits.argmax(2).cpu().numpy()     # [B, T]
            for row, gt in zip(preds, texts):
                pred = greedy_decode(row.tolist(), charset.chars)
                exact += int(pred == gt)
                cer_sum += cer(pred, gt)
                total += 1
    return exact / max(1, total), cer_sum / max(1, total)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="dir with labels.jsonl + images/")
    ap.add_argument("--out", required=True, help="output dir for crnn.pt + charset.json")
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--val-split", type=float, default=0.1)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    charset = Charset(build_charset(load_texts(args.data)))
    save_charset(charset.chars, os.path.join(args.out, "charset.json"))
    print(f"charset: {len(charset)} classes (incl. blank)")

    full = OcrLineDataset(args.data, charset)
    n_val = max(1, int(len(full) * args.val_split))
    n_train = len(full) - n_val
    train_ds, val_ds = random_split(full, [n_train, n_val], generator=torch.Generator().manual_seed(42))
    print(f"samples: {len(full)}  train={n_train}  val={n_val}  device={args.device}")

    train_loader = DataLoader(train_ds, args.batch, shuffle=True, collate_fn=collate, num_workers=args.workers)
    val_loader = DataLoader(val_ds, args.batch, shuffle=False, collate_fn=collate, num_workers=args.workers)

    device = torch.device(args.device)
    model = CRNN(len(charset)).to(device)
    ctc = torch.nn.CTCLoss(blank=0, zero_infinity=True)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)

    best_cer = 1e9
    for epoch in range(1, args.epochs + 1):
        model.train()
        running = 0.0
        for imgs, targets, target_lengths, _ in train_loader:
            imgs = imgs.to(device)
            logits = model(imgs)                       # [B, T, C]
            log_probs = F.log_softmax(logits, dim=2).permute(1, 0, 2)  # [T, B, C]
            T = log_probs.size(0)
            input_lengths = torch.full((imgs.size(0),), T, dtype=torch.long)
            loss = ctc(log_probs, targets.to(device), input_lengths, target_lengths)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            running += loss.item()

        acc, mean_cer = evaluate(model, val_loader, charset, device)
        print(f"epoch {epoch:3d}  loss {running/len(train_loader):.4f}  val_acc {acc:.3f}  val_cer {mean_cer:.4f}")
        if mean_cer < best_cer:
            best_cer = mean_cer
            torch.save({"state_dict": model.state_dict(), "num_classes": len(charset)}, os.path.join(args.out, "crnn.pt"))
            print(f"  saved best (cer {best_cer:.4f}) -> {os.path.join(args.out, 'crnn.pt')}")

    print(f"done. best val CER {best_cer:.4f}. Next: python export_onnx.py --model {args.out}/crnn.pt")


if __name__ == "__main__":
    main()
