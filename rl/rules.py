"""斗地主规则：牌数向量版（与 engine.js 的 classify / genMoves 逐手一致）。
点数 3..17（J=11 Q=12 K=13 A=14 2=15 小王=16 大王=17），向量下标 = 点数-3，长度 15。
"""
from typing import List, Optional, Tuple

NR = 15  # 点数种类


class Info:
    __slots__ = ("type", "main", "n")

    def __init__(self, t, main, n):
        self.type, self.main, self.n = t, main, n


def classify(cnt: List[int]) -> Optional[Info]:
    """cnt: 长度 15 的牌数向量。返回牌型，非法返回 None。"""
    n = sum(cnt)
    if n == 0:
        return None
    ranks = [i + 3 for i in range(NR) if cnt[i]]
    c = lambda r: cnt[r - 3]
    counts = [c(r) for r in ranks]
    with_k = lambda k: next((r for r in ranks if c(r) == k), None)
    if n == 1:
        return Info("single", ranks[0], n)
    if n == 2:
        if len(ranks) == 1:
            return Info("pair", ranks[0], n)
        if c(16) and c(17):
            return Info("rocket", 17, n)
        return None
    if n == 3:
        return Info("triple", ranks[0], n) if len(ranks) == 1 else None
    if n == 4:
        if len(ranks) == 1:
            return Info("bomb", ranks[0], n)
        if len(ranks) == 2 and 3 in counts:
            return Info("triple1", with_k(3), n)
        return None
    top = ranks[-1]
    consec = all(ranks[i] - ranks[i - 1] == 1 for i in range(1, len(ranks)))
    if len(ranks) == n and n >= 5 and consec and top <= 14:
        return Info("straight", ranks[0], n)
    if n >= 6 and n % 2 == 0 and len(ranks) == n // 2 and all(x == 2 for x in counts) and consec and top <= 14:
        return Info("pairs", ranks[0], n)
    if n == 5 and len(ranks) == 2 and 3 in counts and 2 in counts:
        return Info("triple2", with_k(3), n)
    if n == 6 and with_k(4) is not None and not (c(16) and c(17)):
        return Info("four2", with_k(4), n)
    if n == 8 and len(ranks) == 3 and with_k(4) is not None and sum(1 for x in counts if x == 2) == 2:
        return Info("four22", with_k(4), n)
    triples = [r for r in ranks if c(r) >= 3 and r <= 14]
    for k in range(n // 3, 1, -1):
        for s in triples:
            if s + k - 1 > 14:
                continue
            if not all(c(x) >= 3 for x in range(s, s + k)):
                continue
            rest = n - 3 * k
            if rest == 0:
                return Info("plane", s, n)
            if rest == k:
                return Info("plane1", s, n)
            if rest == 2 * k:
                ok = True
                for r in ranks:
                    rem = c(r) - (3 if s <= r < s + k else 0)
                    if rem != 0 and rem != 2:
                        ok = False
                        break
                if ok:
                    return Info("plane2", s, n)
    return None


def can_beat(cur: Info, prev: Optional[Info]) -> bool:
    if cur is None:
        return False
    if prev is None:
        return True
    if cur.type == "rocket":
        return True
    if prev.type == "rocket":
        return False
    if cur.type == "bomb":
        return prev.type != "bomb" or cur.main > prev.main
    if prev.type == "bomb":
        return False
    return cur.type == prev.type and cur.n == prev.n and cur.main > prev.main


def gen_moves(hand: List[int]):
    """返回 [(cnt_tuple, Info)]，与 engine.js genMoves 相同的候选集合（带牌取最“散”的搭配）。"""
    g = {i + 3: hand[i] for i in range(NR) if hand[i]}
    ranks = sorted(g)
    moves = []

    def push(cnt):
        info = classify(cnt)
        if info:
            moves.append((tuple(cnt), info))

    def vec(parts):
        v = [0] * NR
        for r, k in parts:
            v[r - 3] += k
        return v

    for r in ranks:
        L = g[r]
        push(vec([(r, 1)]))
        if L >= 2:
            push(vec([(r, 2)]))
        if L >= 3:
            push(vec([(r, 3)]))
        if L == 4:
            push(vec([(r, 4)]))
    if 16 in g and 17 in g:
        push(vec([(16, 1), (17, 1)]))

    def kicker_order(used):
        """按 (该点数在整手牌里的张数, 点数) 排序的剩余单张列表（used: 点数→已占张数）。"""
        lst = []
        for r in ranks:
            rem = g[r] - used.get(r, 0)
            lst.extend([r] * rem)
        lst.sort(key=lambda r: (g[r], r))
        return lst

    def pair_kickers(excl, k):
        rs = sorted([r for r in ranks if r not in excl and g[r] >= 2 and r < 16], key=lambda r: (g[r], r))[:k]
        if len(rs) < k:
            return None
        return [(r, 2) for r in rs]

    for r in ranks:
        if g[r] < 3 or r > 15:
            continue
        trio = [(r, 3)]
        order = [x for x in kicker_order({r: 3}) if x != r]
        if order:
            push(vec(trio + [(order[0], 1)]))
        pk = pair_kickers({r}, 1)
        if pk:
            push(vec(trio + pk))

    for s in range(3, 15):
        if s not in g:
            continue
        seq = []
        e = s
        while e <= 14 and e in g:
            seq.append((e, 1))
            if len(seq) >= 5:
                push(vec(seq))
            e += 1

    for s in range(3, 15):
        if s not in g or g[s] < 2:
            continue
        seq = []
        e = s
        while e <= 14 and e in g and g[e] >= 2:
            seq.append((e, 2))
            if len(seq) >= 3:
                push(vec(seq))
            e += 1

    for s in range(3, 15):
        if s not in g or g[s] < 3:
            continue
        trios = []
        used = {}
        e = s
        while e <= 14 and e in g and g[e] >= 3:
            trios.append((e, 3))
            used[e] = 3
            k = e - s + 1
            e += 1
            if k < 2:
                continue
            push(vec(trios))
            singles = kicker_order(used)[:k]
            if len(singles) == k:
                push(vec(trios + [(x, 1) for x in singles]))
            pk = pair_kickers(set(range(s, s + k)), k)
            if pk:
                push(vec(trios + pk))

    for r in ranks:
        if g[r] != 4:
            continue
        four = [(r, 4)]
        two = kicker_order({r: 4})[:2]
        if len(two) == 2:
            push(vec(four + [(x, 1) for x in two]))
        pk = pair_kickers({r}, 2)
        if pk:
            push(vec(four + pk))
    return moves


def legal_moves(hand: List[int], last: Optional[Info]):
    """跟牌：只保留能压过 last 的；last 为 None 表示自由出牌（不能不出）。"""
    ms = [(c, i) for c, i in gen_moves(hand) if can_beat(i, last)]
    return ms
