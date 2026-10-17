import numpy as np
import torch
import torch.nn as nn

from env import ADIM, SDIM, XDIM

HID = (512, 512, 256)


class QNet(nn.Module):
    """Q(s, a) → 该方最终获胜的期望回报（+1 胜 / −1 负）。输入 = 状态特征 ‖ 动作特征。"""

    def __init__(self, hid=HID):
        super().__init__()
        dims = (XDIM,) + tuple(hid)
        self.layers = nn.ModuleList([nn.Linear(dims[i], dims[i + 1]) for i in range(len(hid))])
        self.out = nn.Linear(dims[-1], 1)

    def forward(self, x):
        for l in self.layers:
            x = torch.relu(l(x))
        return self.out(x).squeeze(-1)


class NumpyQ:
    """actor 进程里的 CPU 推理：第一层拆成 状态部分 + 动作部分，状态只算一次。"""

    def __init__(self):
        self.w = None

    def load(self, state):
        sd = {k: v.detach().cpu().numpy().astype(np.float32) for k, v in state.items()}
        W0 = sd["layers.0.weight"]                     # [H0, XDIM]
        self.Ws, self.Wa = np.ascontiguousarray(W0[:, :SDIM]), np.ascontiguousarray(W0[:, SDIM:].T)
        self.b0 = sd["layers.0.bias"]
        self.rest = []
        i = 1
        while f"layers.{i}.weight" in sd:
            self.rest.append((np.ascontiguousarray(sd[f"layers.{i}.weight"].T), sd[f"layers.{i}.bias"]))
            i += 1
        self.wo, self.bo = sd["out.weight"].reshape(-1), float(sd["out.bias"][0])

    def q(self, s, A):
        """s: [SDIM] uint8；A: [n, ADIM] uint8 → [n] Q 值"""
        h = np.maximum(self.Ws @ s.astype(np.float32) + self.b0 + A.astype(np.float32) @ self.Wa, 0)
        for W, b in self.rest:
            h = np.maximum(h @ W + b, 0)
        return h @ self.wo + self.bo
