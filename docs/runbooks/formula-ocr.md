# 白板手写转公式服务

状态：active
适用：本地开发、RC、生产白板服务

白板把教师框选的笔迹在浏览器内裁成白底 PNG，经已登录的 Mathin 服务端转发给本机 Pix2Text。学生笔迹不发送给第三方云服务。识别结果返回 LaTeX，教师确认或修订后，才替换原笔迹并进入白板快照与协作事件。

## 启动 Pix2Text

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

在 `.env.local` 中配置：

```dotenv
FORMULA_OCR_URL=http://127.0.0.1:8503/pix2text
```

修改环境变量后重启 `pnpm dev`。服务应只监听环回地址；生产环境若单独部署识别服务，应使用受控内网 HTTPS 地址与网络访问策略，不向公网开放 Pix2Text 端口。

启动完成后先做健康检查：

```powershell
pnpm formula:ocr:check
```

## 验证

1. 登录教师账号并打开白板。
2. 用画笔写一条数学公式。
3. 点击工具条的「手写转公式」，框选笔迹。
4. 等待预览，必要时修改 LaTeX，再点击「插入公式」。
5. 用选择工具移动、缩放或旋转公式，刷新后确认快照恢复。

识别服务未启动时，确认框仍保留 LaTeX 手动输入能力；白板书写、图形和尺规功能不受影响。
