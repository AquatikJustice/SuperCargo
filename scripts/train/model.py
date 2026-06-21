"""CRNN (CNN + BiLSTM) for CTC line recognition - the classic Shi et al. config.

Input : [B, 1, 32, W]   grayscale, normalized to [-1, 1]
Output: [B, T, num_classes]   raw logits (T ~= W/4), CTC blank = index 0

This is intentionally close to the SC_OCR-style architecture so the exported
ONNX runs cheaply on CPU via onnxruntime-node.
"""
import torch
import torch.nn as nn


class CRNN(nn.Module):
    def __init__(self, num_classes, img_h=32, in_ch=1, lstm_hidden=256):
        super().__init__()
        assert img_h == 32, "this CNN stack assumes input height 32"

        def conv(i, o, k=3, s=1, p=1, bn=False):
            layers = [nn.Conv2d(i, o, k, s, p)]
            if bn:
                layers.append(nn.BatchNorm2d(o))
            layers.append(nn.ReLU(inplace=True))
            return layers

        self.cnn = nn.Sequential(
            *conv(in_ch, 64),
            nn.MaxPool2d(2, 2),                       # 32 -> 16,  W -> W/2
            *conv(64, 128),
            nn.MaxPool2d(2, 2),                       # 16 -> 8,   W/2 -> W/4
            *conv(128, 256),
            *conv(256, 256),
            nn.MaxPool2d((2, 2), (2, 1), (0, 1)),     # 8 -> 4,    width kept
            *conv(256, 512, bn=True),
            *conv(512, 512, bn=True),
            nn.MaxPool2d((2, 2), (2, 1), (0, 1)),     # 4 -> 2,    width kept
            *conv(512, 512, k=2, s=1, p=0, bn=True),  # 2 -> 1,    W/4 -> W/4-1
        )

        self.rnn = nn.LSTM(512, lstm_hidden, num_layers=2, bidirectional=True, batch_first=True)
        self.fc = nn.Linear(lstm_hidden * 2, num_classes)

    def forward(self, x):
        f = self.cnn(x)                  # [B, 512, 1, T]
        assert f.size(2) == 1, f"expected feature height 1, got {f.size(2)}"
        f = f.squeeze(2).permute(0, 2, 1)  # [B, T, 512]
        f, _ = self.rnn(f)               # [B, T, 2*hidden]
        return self.fc(f)                # [B, T, num_classes]
