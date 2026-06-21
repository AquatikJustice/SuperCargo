"""Greedy CTC decode + character error rate. Mirrors onnxEngine.ts decoding."""


def greedy_decode(indices, chars, blank=0):
    """Collapse repeats, drop blanks. `indices` = argmax per timestep."""
    out = []
    prev = -1
    for idx in indices:
        if idx != prev and idx != blank:
            out.append(chars[idx])
        prev = idx
    return "".join(out)


def cer(pred, gt):
    """Character error rate via Levenshtein / len(gt)."""
    if not gt:
        return 0.0 if not pred else 1.0
    m, n = len(pred), len(gt)
    prev = list(range(n + 1))
    for i in range(1, m + 1):
        cur = [i] + [0] * n
        for j in range(1, n + 1):
            cost = 0 if pred[i - 1] == gt[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev = cur
    return prev[n] / len(gt)
