"""把检查点导出成浏览器可读的 ddz_nn.bin（float16）。

格式：'DDZN' | u32 json长度 | json | 各层数据（float16 小端，按 json 里的顺序：权重[out][in] 后接偏置）
json: {"sdim":611,"adim":60,"nets":[[{"in":..,"out":..},...] x3]}
第一层权重保持 [out][sdim+adim]，JS 里拆成状态/动作两部分。
"""
import argparse
import json
import struct

import numpy as np
import torch

from env import ADIM, SDIM


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ckpt")
    ap.add_argument("out", nargs="?", default="ddz_nn.bin")
    a = ap.parse_args()
    ck = torch.load(a.ckpt, map_location="cpu")
    meta = {"sdim": SDIM, "adim": ADIM, "nets": [], "step": int(ck.get("step", 0))}
    blobs = []
    for sd in ck["models"]:
        layers = []
        i = 0
        names = []
        while f"layers.{i}.weight" in sd:
            names.append((f"layers.{i}.weight", f"layers.{i}.bias"))
            i += 1
        names.append(("out.weight", "out.bias"))
        for wn, bn in names:
            W = sd[wn].detach().cpu().numpy().astype(np.float32)
            b = sd[bn].detach().cpu().numpy().astype(np.float32)
            layers.append({"in": int(W.shape[1]), "out": int(W.shape[0])})
            blobs.append(W.astype("<f2").tobytes())
            blobs.append(b.astype("<f2").tobytes())
        meta["nets"].append(layers)
    js = json.dumps(meta).encode()
    with open(a.out, "wb") as f:
        f.write(b"DDZN" + struct.pack("<I", len(js)) + js)
        for b in blobs:
            f.write(b)
    print("已导出", a.out, sum(len(b) for b in blobs) / 1e6, "MB, step", meta["step"])


if __name__ == "__main__":
    main()
