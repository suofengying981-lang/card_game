"""训练看门狗：按固定参数启动 train.py；日志超过 --stall 秒没有新内容（GPU 卡死）就杀掉整棵进程树，
用 --resume 从最近的检查点重新启动。用法：python supervise.py [train.py 的参数…]（不要带 --resume）"""
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "train.log")
STALL = 240


def main():
    args = sys.argv[1:]
    env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
    restarts = 0
    while True:
        cmd = [sys.executable, "-W", "ignore", "-u", "train.py"] + args + ["--resume"]
        with open(LOG, "ab") as f:
            f.write(f"=== supervise: start #{restarts} {time.strftime('%H:%M:%S')} ===\n".encode())
            p = subprocess.Popen(cmd, cwd=HERE, stdout=f, stderr=subprocess.STDOUT, env=env)
        t0 = time.time()
        while p.poll() is None:
            time.sleep(15)
            quiet = time.time() - max(os.path.getmtime(LOG), t0)
            if quiet > STALL:
                with open(LOG, "ab") as f:
                    f.write(f"=== supervise: no log for {int(quiet)}s, restarting ===\n".encode())
                subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)
                break
        else:
            if p.returncode == 0:
                return                      # 正常结束（例如到了 --max-minutes）
        restarts += 1
        time.sleep(5)


if __name__ == "__main__":
    main()
