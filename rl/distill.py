"""把「困难」档（蒙特卡洛推演）的判断蒸馏进网络：监督学习，目标 = 推演给每个候选出法的胜率。

  1) node gen_teacher.js teacher/pN.bin 45 250 8      （并行多个，生成教师数据）
  2) python distill.py --init ckpt/last.pt --out ckpt_distill --epochs 20
  3) python export.py ckpt_distill/last.pt ../ddz_nn.bin
"""
import argparse
import glob
import os
import struct
import time

import numpy as np
import torch
import torch.nn.functional as F

from env import ADIM, SDIM
from model import QNet

CMAX = 12


def load_files(paths):
    states, seats, ncs, acts, tgts = [], [], [], [], []
    for p in paths:
        b = open(p, "rb").read()
        i, nb = 0, len(b)
        while i + 2 + SDIM <= nb:
            me, n = b[i], b[i + 1]
            end = i + 2 + SDIM + n * (ADIM + 4)
            if end > nb:
                break                                   # 文件被截断（worker 被中途停止）
            i += 2
            states.append(np.frombuffer(b, np.uint8, SDIM, i)); i += SDIM
            a = np.zeros((CMAX, ADIM), np.uint8)
            t = np.zeros(CMAX, np.float32)
            for k in range(min(n, CMAX)):
                a[k] = np.frombuffer(b, np.uint8, ADIM, i)
                t[k] = struct.unpack_from("<f", b, i + ADIM)[0]
                i += ADIM + 4
            i += max(0, n - CMAX) * (ADIM + 4)
            seats.append(me); ncs.append(min(n, CMAX)); acts.append(a); tgts.append(t)
    return (np.stack(states), np.array(seats, np.int64), np.array(ncs, np.int64), np.stack(acts), np.stack(tgts))


def forward(net, s, a):
    """s [B,SDIM] uint8，a [B,C,ADIM] uint8 → [B,C]"""
    B, C = a.shape[:2]
    x = torch.cat([s.float().unsqueeze(1).expand(B, C, SDIM), a.float()], dim=-1).reshape(B * C, SDIM + ADIM)
    return net(x).reshape(B, C)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="teacher/p*.bin")
    ap.add_argument("--init", default="ckpt/last.pt")
    ap.add_argument("--out", default="ckpt_distill")
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--tau", type=float, default=0.2)
    ap.add_argument("--rank", type=float, default=0.5, help="列表排序损失的权重")
    ap.add_argument("--device", default="cuda")
    args = ap.parse_args()
    dev = torch.device(args.device)

    paths = sorted(glob.glob(args.data))
    t0 = time.time()
    S, M, NC, A, T = load_files(paths)
    print(f"读入 {len(paths)} 个文件：{len(S)} 个决策，平均候选 {NC.mean():.2f}，{time.time() - t0:.0f}s", flush=True)

    rng = np.random.RandomState(0)
    perm = rng.permutation(len(S))
    nval = max(1000, len(S) // 20)
    val_idx, tr_idx = perm[:nval], perm[nval:]
    tS, tA, tT = (torch.from_numpy(x).to(dev) for x in (S, A, T))
    tM = torch.from_numpy(M).to(dev)
    mask_all = (torch.arange(CMAX).unsqueeze(0) < torch.from_numpy(NC).unsqueeze(1)).to(dev)

    ck = torch.load(args.init, map_location=dev)
    nets = [QNet().to(dev) for _ in range(3)]
    for n, sd in zip(nets, ck["models"]):
        n.load_state_dict(sd)
    opts = [torch.optim.Adam(n.parameters(), lr=args.lr) for n in nets]

    def evaluate(idx):
        res = []
        for seat in range(3):
            sel = torch.from_numpy(idx[M[idx] == seat]).to(dev)
            if len(sel) == 0:
                res.append((0, 0, 0)); continue
            with torch.no_grad():
                q = forward(nets[seat], tS[sel], tA[sel])
                mk = mask_all[sel]
                tg = tT[sel]
                mse = ((q - tg) ** 2)[mk].mean().item()
                qm = q.masked_fill(~mk, -1e9); tm = tg.masked_fill(~mk, -1e9)
                top1 = (qm.argmax(1) == tm.argmax(1)).float().mean().item()
                # 选中的出法在教师眼里比最优差多少（越小越好）
                regret = (tm.max(1).values - tg.gather(1, qm.argmax(1, keepdim=True)).squeeze(1)).mean().item()
            res.append((mse, top1, regret))
        return res

    def show(tag):
        r = evaluate(val_idx)
        print(tag, " | ".join(f"座位{s}: mse {m:.3f} 同教师 {t:.1%} 平均亏 {g:.3f}" for s, (m, t, g) in enumerate(r)), flush=True)

    os.makedirs(args.out, exist_ok=True)
    show("蒸馏前（RL 网络）")
    for ep in range(args.epochs):
        t1 = time.time()
        for seat in range(3):
            idx = tr_idx[M[tr_idx] == seat]
            idx = torch.from_numpy(rng.permutation(idx)).to(dev)
            net, opt = nets[seat], opts[seat]
            for i in range(0, len(idx), args.batch):
                b = idx[i:i + args.batch]
                q = forward(net, tS[b], tA[b])
                mk, tg = mask_all[b], tT[b]
                mse = ((q - tg) ** 2)[mk].mean()
                logp = F.log_softmax((q / args.tau).masked_fill(~mk, -1e9), dim=1)
                pt = F.softmax((tg / args.tau).masked_fill(~mk, -1e9), dim=1)
                kl = (pt * (torch.log(pt + 1e-9) - logp)).sum(1).mean()
                loss = mse + args.rank * kl
                opt.zero_grad(set_to_none=True)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(net.parameters(), 10.0)
                opt.step()
        show(f"第 {ep + 1:2d} 轮 ({time.time() - t1:.0f}s)")
        torch.save({"models": [n.state_dict() for n in nets], "opts": [o.state_dict() for o in opts], "step": ck.get("step", 0)},
                   os.path.join(args.out, "last.tmp"))
        os.replace(os.path.join(args.out, "last.tmp"), os.path.join(args.out, "last.pt"))


if __name__ == "__main__":
    main()
