# 白板手写转公式服务

状态：active
适用：本地开发、RC、生产白板服务

白板把教师框选的笔迹在浏览器内裁成白底 PNG，经已登录的 Mathin 服务端转发给 Pix2Text。学生笔迹不发送给第三方云服务。识别结果返回 LaTeX，教师确认或修订后，才替换原笔迹并进入白板快照与协作事件。

## 部署拓扑

```text
浏览器
  └─ HTTPS /api/whiteboard/formula
       └─ Xiaomi Mathin Next.js 127.0.0.1:3131
            └─ HTTP Pix2Text 127.0.0.1:8503
                 └─ 持久模型缓存 /home/swing/services/mathin-formula-ocr/models
```

生产公式图片只能在 Xiaomi 同主机回环链路中流动。Pix2Text 不配置 Caddy
路由、不加入 Sakura FRP、不监听 `192.168.5.183` 或 `0.0.0.0`，也不从
Windows 开发机 `192.168.5.213` 提供生产识别。Next 生产运行时缺少
`FORMULA_OCR_URL`、配置为非回环地址或 OCR 不健康时，发布和请求都会失败关闭。

## 本地开发

Python 3.10～3.12 环境中安装开源服务：

```powershell
python -m pip install "pix2text>=1.1.4,<2" fastapi uvicorn python-multipart
pnpm formula:ocr
```

`fastapi`、`uvicorn` 与 `python-multipart` 是 `p2t serve` 的运行依赖；Pix2Text 1.1.6
不会随主包自动安装这三项。项目启动器按以下顺序寻找服务命令：

1. `FORMULA_OCR_EXECUTABLE` 指定的 `p2t`；
2. Windows 的 `.tmp/formula-ocr/Scripts/p2t.exe` 或 POSIX 的 `.tmp/formula-ocr/bin/p2t`；
3. `PATH` 中的 `p2t`。

Windows 只有 Python 3.13 时，可先运行
`conda create --prefix .tmp/formula-ocr python=3.12 -y`，再用
`.\.tmp\formula-ocr\python.exe -m pip install ...` 安装上述依赖。`.tmp/` 已被 Git 忽略。

首次启动会下载模型。无 GPU 时可用 CPU 运行；课堂主机若配置 CUDA，按 Pix2Text 文档安装对应的 ONNX Runtime GPU 依赖。

开发机 `.env.local` 使用：

```dotenv
FORMULA_OCR_URL=http://127.0.0.1:8503/pix2text
```

修改环境变量后重启 `pnpm dev`，再运行：

```powershell
pnpm formula:ocr:check
```

该开发进程只服务 `192.168.5.213:3130` 的开发站点，不承担 RC/生产流量。

## Xiaomi RC/生产部署

Xiaomi 已具备 Docker 与 Docker Compose；系统 Python 版本不参与 OCR 运行。部署脚本
构建固定 Python 3.12 / Pix2Text 1.1.6 镜像，限制容器为 3 CPU、3 GiB 内存、
256 个进程，并移除 Linux capabilities、启用只读根文件系统和
`no-new-privileges`。只有模型缓存目录与临时目录可写。

从已提交的 Mathin 源码执行：

```bash
ssh xiaomi
cd /path/to/committed/mathin-source
proxy_on
bash scripts/ops/deploy-formula-ocr-linux.sh "$PWD"
```

首次启动需要从 Hugging Face 下载模型，脚本最多等待 15 分钟。模型缓存在
`/home/swing/services/mathin-formula-ocr/models`，后续容器升级复用，不进入 Git
或应用 release。

生产配置 `/home/swing/services/mathin/config/.env.production.local` 必须包含：

```dotenv
FORMULA_OCR_URL=http://127.0.0.1:8503/pix2text
```

部署顺序固定为：

1. 部署或升级 OCR 容器，等待 `/docs` 健康。
2. 写入并复核生产 `FORMULA_OCR_URL`。
3. 发布 Mathin standalone release；发布脚本会在构建前复核 1～2。
4. 用固定教师账号完成公式框选、识别、修订、插入和刷新恢复。

主机验收：

```bash
docker inspect --format '{{.State.Status}}/{{.State.Health.Status}}' mathin-formula-ocr
curl --noproxy '*' -fsS http://127.0.0.1:8503/docs >/dev/null
ss -ltn 'sport = :8503'
```

`ss` 只能显示 `127.0.0.1:8503`（或 IPv6 `::1`），不得出现
`0.0.0.0:8503`、`[::]:8503` 或 Xiaomi 局域网地址。生产状态检查入口
`scripts/ops/publish-mathin-xiaomi.ps1 -Action Status` 同时显示容器和回环健康。

回退时先让 Mathin 保留手动 LaTeX 输入降级，再在 Xiaomi 执行：

```bash
cd /home/swing/services/mathin-formula-ocr
docker compose stop formula-ocr
```

停止 OCR 不影响画笔、图形、尺规或既有公式对象；自动识别会返回服务不可用。
恢复使用 `docker compose up -d formula-ocr`。不得用开放 8503 端口或改指
Windows 开发机的方式绕过健康门。

## 验证

1. 登录教师账号并打开白板。
2. 用画笔写一条数学公式。
3. 点击工具条的「手写转公式」，框选笔迹。
4. 等待预览，必要时修改 LaTeX，再点击「插入公式」。
5. 用选择工具移动、缩放或旋转公式，刷新后确认快照恢复。

识别服务未启动时，确认框仍保留 LaTeX 手动输入能力；白板书写、图形和尺规功能不受影响。
