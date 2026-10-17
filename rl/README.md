# 斗地主神经网络训练（DouZero 思路精简版）

环境：Windows/Linux + NVIDIA GPU（如 5090D），Python 3.10+。
5090 需要支持 Blackwell 的 PyTorch（CUDA 12.8+ 的版本），例如：

    pip install torch --index-url https://download.pytorch.org/whl/cu128
    pip install numpy

训练（先停掉 Ollama 等占 GPU 的任务）：

    cd rl
    python train.py --actors 16 --device cuda --batch 4096 --out ckpt
    # Ctrl+C 随时停止，下次加 --resume 继续

导出给浏览器用：

    python export.py ckpt/last.pt ../ddz_nn.bin

- `rules.py` 与 `engine.js` 的出法枚举逐手一致（4000 手随机牌核对过）。
- `nn.js` 是浏览器端推理，已核对与 Python 输出一致（特征逐位相同，Q 值误差 < 1e-3）。
- actor 数建议 = CPU 核数 − 2；日志里的“局/s”是自对弈速度，瓶颈在 CPU 不在 GPU。
