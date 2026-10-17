"""斗地主自对弈环境（只含出牌阶段；叫牌由现有的 JS 蒙特卡洛叫牌负责）。
座位：0=地主，1=地主的下家，2=地主的上家；出牌顺序 0→1→2→0。
"""
import random
from typing import List, Optional

import numpy as np

from rules import NR, Info, can_beat, classify, gen_moves

FULL = [4] * 13 + [1, 1]          # 3..2 各 4 张，小王大王各 1 张
SEATS = 3
SDIM = 611                         # 状态特征维度
ADIM = 60                          # 动作特征维度
XDIM = SDIM + ADIM


def deal(rng: random.Random):
    deck = []
    for i in range(13):
        deck += [i] * 4
    deck += [13, 14]
    rng.shuffle(deck)
    hands = [[0] * NR for _ in range(3)]
    for k, c in enumerate(deck[:17]):
        hands[1][c] += 1
    for c in deck[17:34]:
        hands[2][c] += 1
    for c in deck[34:51]:
        hands[0][c] += 1
    bottom = [0] * NR
    for c in deck[51:]:
        hands[0][c] += 1
        bottom[c] += 1
    # 注意：发牌顺序无所谓，这里 0 号拿 17+3 张
    return hands, bottom


def onehot_counts(cnt) -> np.ndarray:
    """牌数向量 → 15×4 的累计 one-hot（count>=1..4），展平成 60 维 float32。"""
    a = np.zeros((NR, 4), dtype=np.uint8)
    for i, c in enumerate(cnt):
        if c:
            a[i, :c] = 1
    return a.reshape(-1)


class Game:
    def __init__(self, rng: Optional[random.Random] = None):
        self.rng = rng or random.Random()
        self.reset()

    def reset(self):
        self.hands, self.bottom = deal(self.rng)
        self.played = [[0] * NR for _ in range(3)]
        self.turn = 0
        self.last: Optional[Info] = None
        self.last_by = -1
        self.passes = 0
        self.acts = []              # 最近动作（牌数向量或 None=不出）
        self.bombs = 0
        self.winner = -1            # 赢的座位（0 地主赢 / 地主方赢）
        self.steps = 0

    # ---- 合法动作 ----
    def legal(self):
        h = self.hands[self.turn]
        free = self.last is None or self.passes >= 2 or self.last_by == self.turn
        last = None if free else self.last
        ms = [(c, i) for c, i in gen_moves(h) if can_beat(i, last)]
        if not free:
            ms.append((None, None))   # 不出
        return ms

    def step(self, move):
        """move: (cnt_tuple, Info) 或 (None, None) 表示不出。"""
        s = self.turn
        cnt, info = move
        self.steps += 1
        if cnt is None:
            self.passes += 1
            self.acts.append((s, None))
        else:
            h = self.hands[s]
            for i in range(NR):
                h[i] -= cnt[i]
                self.played[s][i] += cnt[i]
            self.last, self.last_by, self.passes = info, s, 0
            if info.type in ("bomb", "rocket"):
                self.bombs += 1
            self.acts.append((s, cnt))
            if sum(h) == 0:
                self.winner = s
                return True
        self.turn = (s + 1) % 3
        return False

    def team_won(self, seat):
        """seat 所在方是否获胜。"""
        landlord_win = self.winner == 0
        return landlord_win if seat == 0 else not landlord_win

    # ---- 特征 ----
    def state_features(self, seat=None) -> np.ndarray:
        s = self.turn if seat is None else seat
        nxt, prv = (s + 1) % 3, (s + 2) % 3
        unseen = [FULL[i] - self.hands[s][i] - sum(self.played[k][i] for k in range(3)) for i in range(NR)]
        f = [onehot_counts(self.hands[s]), onehot_counts(unseen),
             onehot_counts(self.played[s]), onehot_counts(self.played[nxt]), onehot_counts(self.played[prv])]
        # 最近三个动作：[上家的, 下家的, 自己的]（按时间倒序取）
        slots = [np.zeros(60, dtype=np.uint8) for _ in range(3)]
        for k in range(3):
            if len(self.acts) > k:
                who, cnt = self.acts[-1 - k]
                if cnt is not None:
                    slots[k] = onehot_counts(cnt)
        f += slots
        left = np.zeros(63, dtype=np.uint8)
        for k, p in enumerate((s, nxt, prv)):
            left[k * 21 + sum(self.hands[p])] = 1
        f.append(left)
        b = np.zeros(8, dtype=np.uint8)
        b[min(self.bombs, 7)] = 1
        f.append(b)
        f.append(onehot_counts(self.bottom))
        out = np.concatenate(f)
        assert out.shape[0] == SDIM, out.shape
        return out

    @staticmethod
    def action_features(move) -> np.ndarray:
        cnt = move[0]
        if cnt is None:
            return np.zeros(ADIM, dtype=np.uint8)
        return onehot_counts(cnt)
