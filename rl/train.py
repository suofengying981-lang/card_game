"""斗地主 DMC 自对弈训练（DouZero 思路的精简版）。

  python train.py --actors 16 --device cuda

多个 CPU actor 用当前网络自对弈（ε-贪心），把 (状态,动作)→终局胜负 样本送给 GPU 学习器；
学习器对 3 个座位各训练一个 Q 网络（MSE 回归终局 ±1）。每隔一段时间保存检查点并导出权重。
"""
import os

# actor 是一进程一核：必须在导入 numpy 之前把 BLAS 线程数限为 1，否则每个进程各开多线程互相抢核，速度掉一半以上
for _k in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ.setdefault(_k, "1")

import argparse
import random
import time

import numpy as np
import torch
import torch.multiprocessing as mp

from env import ADIM, SDIM, XDIM, Game
from model import NumpyQ, QNet


def actor(idx, models_state, queue, stop, eps, seed, nenv):
    """每个 actor 同时跑 nenv 局，把各局当前的决策合并成一批做网络推理（比一局一局算快得多）。"""
    torch.set_num_threads(1)
    rng = random.Random(seed + idx * 1009)
    nq = [NumpyQ() for _ in range(3)]
    ver = -1
    games = [Game(random.Random(rng.random())) for _ in range(nenv)]
    recs = [[[], [], []] for _ in range(nenv)]       # 每局每个座位：[(state, action)]
    pend = [None] * nenv                             # 每局当前待决策：(seat, 状态特征, 候选动作特征, 候选)

    def advance(i):
        """把第 i 局推进到下一个需要网络决策的时刻；局终返回 True。"""
        g = games[i]
        while True:
            ms = g.legal()
            if len(ms) == 1:
                if g.step(ms[0]):
                    return True
            else:
                pend[i] = (g.turn, g.state_features(), np.stack([g.action_features(x) for x in ms]), ms)
                return False

    def finish(i):
        g = games[i]
        out = []
        for seat in range(3):
            if not recs[i][seat]:
                continue
            y = 1.0 if g.team_won(seat) else -1.0
            X = np.stack([np.concatenate([s, a]) for s, a in recs[i][seat]])
            out.append((seat, X, y))
        try:
            queue.put((out, g.winner == 0, g.bombs), timeout=5)
        except Exception:
            pass
        g.reset()
        recs[i] = [[], [], []]

    def settle(i):
        while advance(i):
            finish(i)

    for i in range(nenv):
        games[i].reset()
        settle(i)
    while not stop.is_set():
        v = models_state["ver"].item()
        if v != ver:
            for s in range(3):
                nq[s].load(models_state["w"][s])
            ver = v
        for seat in range(3):
            idxs = [i for i in range(nenv) if pend[i][0] == seat]
            if not idxs:
                continue
            qs = nq[seat].q_batch(np.stack([pend[i][1] for i in idxs]), [pend[i][2] for i in idxs])
            for i, q in zip(idxs, qs):
                _, sf, A, ms = pend[i]
                k = rng.randrange(len(ms)) if rng.random() < eps else int(np.argmax(q))
                recs[i][seat].append((sf, A[k]))
                if games[i].step(ms[k]):
                    finish(i)
                settle(i)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--actors", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    ap.add_argument("--envs", type=int, default=24, help="每个 actor 同时跑的局数（批量推理）")
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--batch", type=int, default=2048)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--eps", type=float, default=0.03)
    ap.add_argument("--buffer", type=int, default=400000, help="每个座位的样本上限")
    ap.add_argument("--min-buffer", type=int, default=20000)
    ap.add_argument("--replay", type=float, default=4.0, help="每个新样本平均被训练几次")
    ap.add_argument("--sync", type=int, default=200, help="每多少步把权重同步给 actor")
    ap.add_argument("--save-every", type=int, default=3000)
    ap.add_argument("--out", default="ckpt")
    ap.add_argument("--max-minutes", type=float, default=0, help=">0 时到点自动停止")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    dev = torch.device(args.device)
    torch.manual_seed(args.seed)

    models = [QNet().to(dev) for _ in range(3)]
    opts = [torch.optim.RMSprop(m.parameters(), lr=args.lr, alpha=0.99, eps=1e-5) for m in models]
    step = 0
    if args.resume and os.path.exists(os.path.join(args.out, "last.pt")):
        ck = torch.load(os.path.join(args.out, "last.pt"), map_location=dev)
        for m, sd in zip(models, ck["models"]):
            m.load_state_dict(sd)
        for o, sd in zip(opts, ck["opts"]):
            o.load_state_dict(sd)
        step = ck["step"]
        print("已恢复检查点 step", step)

    # actor 共享的 CPU 权重
    shared = {"ver": torch.zeros(1, dtype=torch.long).share_memory_(), "w": []}
    for m in models:
        sd = {k: v.detach().cpu().clone().share_memory_() for k, v in m.state_dict().items()}
        shared["w"].append(sd)

    def publish():
        for m, sd in zip(models, shared["w"]):
            for k, v in m.state_dict().items():
                sd[k].copy_(v.detach().cpu())
        shared["ver"] += 1

    publish()
    ctx = mp.get_context("spawn")
    queue = ctx.Queue(maxsize=args.actors * 4)
    stop = ctx.Event()
    procs = [ctx.Process(target=actor, args=(i, shared, queue, stop, args.eps, args.seed, args.envs), daemon=True) for i in range(args.actors)]
    for p in procs:
        p.start()

    cap = args.buffer
    bufX = [np.zeros((cap, XDIM), dtype=np.uint8) for _ in range(3)]
    bufY = [np.zeros(cap, dtype=np.float32) for _ in range(3)]
    size = [0, 0, 0]
    pos = [0, 0, 0]
    games = 0
    ll_wins = 0
    bomb_sum = 0
    new_samples = 0
    t0 = time.time()
    last_log = t0
    losses = [[], [], []]
    credit = 0.0

    def add(seat, X, y):
        n = len(X)
        idx = (pos[seat] + np.arange(n)) % cap
        bufX[seat][idx] = X
        bufY[seat][idx] = y
        pos[seat] = (pos[seat] + n) % cap
        size[seat] = min(cap, size[seat] + n)

    try:
        while True:
            # 收样本
            got = 0
            while got < 64:
                try:
                    out, lw, bm = queue.get(timeout=0.05)
                except Exception:
                    break
                for seat, X, y in out:
                    add(seat, X, y)
                    new_samples += len(X)
                    credit += len(X) * args.replay / args.batch / 3
                games += 1
                ll_wins += int(lw)
                bomb_sum += bm
                got += 1
            # 训练
            trained = 0
            while credit >= 1 and min(size) >= args.min_buffer and trained < 8:
                credit -= 1
                trained += 1
                for s in range(3):
                    idx = np.random.randint(0, size[s], args.batch)
                    x = torch.from_numpy(bufX[s][idx]).to(dev).float()
                    y = torch.from_numpy(bufY[s][idx]).to(dev)
                    pred = models[s](x)
                    loss = torch.mean((pred - y) ** 2)
                    opts[s].zero_grad(set_to_none=True)
                    loss.backward()
                    torch.nn.utils.clip_grad_norm_(models[s].parameters(), 40.0)
                    opts[s].step()
                    losses[s].append(loss.item())
                step += 1
                if step % args.sync == 0:
                    publish()
                if step % args.save_every == 0:
                    save(models, opts, step, args.out)
            if min(size) < args.min_buffer:
                credit = 0
            credit = min(credit, 50)
            now = time.time()
            if now - last_log > 30:
                dt = now - t0
                msg = f"[{dt / 60:6.1f}min] step {step} 局数 {games} ({games / dt:.1f}局/s) 地主胜率 {ll_wins / max(1, games):.2f} 均炸弹 {bomb_sum / max(1, games):.2f} 缓冲 {size[0] // 1000}k/{size[1] // 1000}k/{size[2] // 1000}k "
                msg += "loss " + "/".join(f"{np.mean(l[-200:]):.3f}" if l else "-" for l in losses)
                print(msg, flush=True)
                last_log = now
            if args.max_minutes and (now - t0) / 60 > args.max_minutes:
                break
    except KeyboardInterrupt:
        print("收到中断，保存检查点…")
    finally:
        stop.set()
        save(models, opts, step, args.out)
        for p in procs:
            p.terminate()


def save(models, opts, step, out):
    ck = {"models": [m.state_dict() for m in models], "opts": [o.state_dict() for o in opts], "step": step}
    tmp = os.path.join(out, "last.tmp")
    torch.save(ck, tmp)
    os.replace(tmp, os.path.join(out, "last.pt"))
    if step and step % 20000 == 0:
        torch.save(ck, os.path.join(out, f"step{step}.pt"))
    print(f"已保存检查点 step {step}", flush=True)


if __name__ == "__main__":
    main()
