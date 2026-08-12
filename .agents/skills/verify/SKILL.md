---
name: verify
description: 本仓库的端到端验证配方。用于复用或启动本地 dev server，以仓库 Playwright 和固定开发账号验证 zh/en、角色旅程、Canvas、移动布局、局域网目标与截图；不得创建一次性账号或把本机地址写入共享证据。
---

# Mathin 端到端验证配方

## 启动句柄

- 优先复用 `http://localhost:3130` 上已有的 `pnpm dev`；先用 Windows `Get-NetTCPConnection -LocalPort 3130 -State Listen` 检查。没有监听时再从仓库后台启动 `pnpm dev`，不要打开可见终端窗口。
- 使用仓库已经锁定的 Playwright 配置和依赖，优先运行 `pnpm e2e` 或对应的定向 spec；不要在仓库或临时目录重复安装 Playwright。

## 账号

- 复用 `.claude/test-accounts.local.md` 中的 5 个固定开发账号；该文件已 gitignore，禁止复制账号、密码、UUID 或 Cookie 到日志、截图、测试源码和提交。
- 不得为普通 E2E 新建账号。只有验证未认领绑定码、多子女等必须依赖新身份的流程时，先向用户确认，再在隔离开发数据中创建并清理。
- 登录后的等待条件使用精确 dashboard/目标 URL 或明确错误状态，不要用会立即匹配当前页的宽松 locale 正则。

## 常用断言技巧

- Canvas 类页面：`ctx.getImageData` 统计非透明像素占比，比较操作前后变化（画→增、擦→减、撤销→回升、刷新→不变）。
- 保存状态：顶栏 `[role="status"]` 文本（保存中…/已保存）。防抖 1.5s，等 2.6s 再断言。
- shadcn Dialog：用 `page.getByRole("dialog")` + `getByRole("button", { name: … })`，不要 `div[role=dialog] >> text=` 链式。
- 越权探针：使用固定账号中没有该资源关系的另一角色直访资源 URL，RLS 生效应得到 404 页面；匿名访问应 302 到 `/zh/login?next=…`。
- 截图四档：亮/暗（`page.emulateMedia({ colorScheme })`）× 桌面 1440×900 / 移动 390×844。移动截图里左下角圆形 “N” 是 Next.js dev 指示器，不是页面 UI。

## 陷阱

- 需要验证局域网非安全上下文时，从用户给出的 URL、当前 `PLAYWRIGHT_BASE_URL` 或本机实际监听地址确定目标；不要在共享 skill、测试和证据里硬编码某台机器的 IP。localhost 通过不能代替已明确要求的 LAN 验证。

- PowerShell 读取含 `[locale]` 的路径时使用 `-LiteralPath`；搜索优先使用 `rg`。
- 一次性脚本、截图和 trace 放系统临时目录或受控 CI artifact，不放仓库；仓库只保留可复用测试和本配方。
