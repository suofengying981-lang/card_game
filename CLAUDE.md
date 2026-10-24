# 棋牌大厅（card_game）项目说明 —— 给后续接手的会话

纯前端网页棋牌合集（斗地主 / 德州 / 桥牌 / 掼蛋 / 国标麻将 / 四川麻将 / 跳棋 / 军旗），推送到 `main` 后 GitHub Actions 自动构建安卓 APK 并部署 Pages。
玩法、文件表、各游戏 AI 的说明在 `README.md`；斗地主网络的训练 / 导出流程在 `rl/README.md`；每次改动的原因看 `git log`。**本文件只记 README 里没有的东西。**

## 协作约定（有多个会话改同一个仓库）
- 云端 Claude Code 会话和本机桌面会话共用仓库。**开工前、推送前先 `git pull --ff-only`**；小步提交，别同时改同一个文件。
- 云端会话只能改代码、跑浏览器模拟；**GPU 训练、真机相关只能在本机会话做**（云端容器连不上这台电脑）。
- 所有改动都**没有在真机上跑过**，只测了模拟浏览器和 CI 构建；手感类问题要等用户反馈。

## 已有的结论（别重复试）
**有效的**
- 斗地主：对局记录功能（菜单里复制 / 下载），用来让 Claude 评估 AI。
- 斗地主：「提示」改为蒙特卡洛推演建议（前 3 手胜率 + 理由）和赛后复盘；推演接口是 `mcGen` 的 `opt.out` / `opt.extra`。
- 斗地主网络：**批量推理 + BLAS 单线程** 把自对弈从 ~650 提到 ~3900 局/s（见 `rl/train.py`、`rl/model.py` 的 `q_batch`）。
- 斗地主网络：**蒸馏「困难」档**（`rl/gen_teacher.js` → `rl/distill.py`，约 20 轮后过拟合，最佳在第 20 轮左右）：对困难档，当农民胜率 43.6% → 56.0%（困难农民约 64%），当地主持平（36.9% vs 困难自身 36.1%）；对「普通」启发式 52.6% → 58.0%。
- 掼蛋：「拆牌评估」（把手牌拆成最少出牌回合），困难档对普通档约 80%。
- 掼蛋：自对战调参，专家档只比困难档强 3.4 个百分点（5000 局，±1.4%）。

**试过但没用的**
- 斗地主：根据出牌历史推断对手手牌，对战只有 48.3%（±5.7）。
- 斗地主：给网络外面加硬规则兜底（对手只剩 1~2 张必须压、不送单张），对原网络 48.5%~49.7%，略差，**已撤回**。
- 斗地主：纯自对弈强化学习的网络档已进入平台期，训练 5.7 万步 → 40.8 万步对旧权重只有约 52%；对「困难」档仍落后（农民 56% vs 64%）。
- 掼蛋：随机猜牌加模拟到终局，对困难档 46%~50%，还慢上百倍。

**没做的**
- 斗地主：农民的上家 / 下家分工规则。
- 斗地主网络：更多教师数据（蒸馏过拟合说明 27.7 万决策偏少，约 1 小时可再生成几倍）、更大网络、加入完整出牌历史；用蒸馏网络当推演里的快速策略。
- 掼蛋：「简单」「普通」两档差距太小，可以把简单放水一些；也可以套斗地主的网络训练流程。
- 大模型讲解 / 复盘文字、叫牌评估网络、军旗的「信念网络」（预测暗子身份）。

## 评测方法
- 同一副牌**双方换位各打一次**；样本 ≥ 250 副（标准误约 3%），小于 2% 的差别当作噪声。
- 网络对「困难」档：`MODEL=ddz_nn.bin node rl/eval_vs_hard.js 500 25`，开 10 个进程并行（推演是按墙钟时间的，机器忙时样本会变少）。
- 网络之间直接对打、对启发式档：`DDZNN.pick` + `DDZ.aiPlay`，参考 `rl/eval_vs_hard.js` 的对局循环。

## 常用命令
- 本地预览：`cd card_game && python -m http.server 18765`（**Windows 上 8765 在保留端口范围，会报 WinError 10013**）。浏览器里有 Service Worker 缓存，改了代码要清缓存或递增 `sw.js` 的 `CACHE` 版本号。
- 生成安卓打包文件：`node scripts/build-www.js`（新增页面 / 脚本要同步加到它和 `sw.js` 的文件表）。
- 斗地主网络训练（本机 GPU）：`python rl/supervise.py --actors 22 --envs 48 --device cuda --batch 4096 --replay 6 --buffer 1000000 --min-buffer 100000 --save-every 2000 --out ckpt`（看门狗，见下）。
- 蒸馏：`node rl/gen_teacher.js teacher/pN.bin 45 250 8`（并行开 ~22 个）→ `python rl/distill.py --init ckpt/last.pt --out ckpt_distill --epochs 22 --lr 3e-4` → `python rl/export.py ckpt_distill/last.pt ddz_nn.bin`。

## 环境经验（Windows 本机）
- **训练会偶发卡死在 `loss.item()`（GPU 同步不返回）**，间隔几十分钟到几小时，原因没查到；主进程 CPU 100% 但日志不动。`rl/supervise.py` 在日志 4 分钟没更新时会杀进程树并从检查点续训。手动杀要**先杀看门狗**。
- 必须在导入 numpy 前把 `OMP_NUM_THREADS` 等设为 1（`train.py` 已处理），否则 actor 抢核，速度掉一半。
- Git 全局配置里 GitHub 的代理端口可能失效；推送 / 拉取失败时用 `git -c http.https://github.com.proxy=http://127.0.0.1:<实际端口> ...`，先用 `netstat` 看哪个端口在监听。
- Git Bash 里 Python 看不到 `/tmp`；临时文件用系统临时目录的 Windows 路径。
- 本机没有 `gh`，查 Actions / 发布用 GitHub REST（`curl https://api.github.com/repos/suofengying981-lang/card_game/...`）；本机是 JDK 21，工程要 JDK 17 + SDK 34，**APK 只用 CI 构建**。
- 云端容器：`git fetch` 之后没有 `origin/main` 引用，用 `git ls-remote origin main` 对比；容器里的 `gh` 不能用 GraphQL，要用 REST（`gh api`）。

## 只在本机、不在 Git 里的数据（别删）
- `rl/ckpt`（可续训检查点和各阶段快照）、`rl/ckpt_distill`、`rl/teacher`（蒸馏教师数据，约 240 MB）、`rl/*.log`。
- APP 用的权重 `ddz_nn.bin` 已在仓库里；没有上面的检查点就不能续训（只能从权重微调）。

## 发布
- APK 固定下载地址（每次推送自动更新）：https://github.com/suofengying981-lang/card_game/releases/download/apk-latest/qipai.apk
- 安卓签名密钥随仓库公开（个人自用），不要用于应用商店。
