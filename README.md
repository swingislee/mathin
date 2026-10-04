# Mathin

面向数学理解、教师课堂和学校日常工作的产品。Terms 提供可关联的数学知识入口；Story、Minds、Games、Tools 与课堂材料把内容变成可阅读、可探索、可操作的体验。

- [产品方向](docs/product-direction.md)：具体使用现场、构思方法与历史案例。
- [当前状态](docs/current.md)：实现、部署和人工验收事实。
- [文档导航](docs/README.md)：按工作场景查阅。
- [施工入口](AGENTS.md)：Agent 每轮需要的信息。
- [历史归档](archive/README.md)：旧规划、证据和流程的原始材料；测试保留原位供按需调用。

## 本地使用

使用仓库锁定的 Node / pnpm 依赖，私有连接配置放在忽略的本地文件或环境变量。

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

开发端默认 3130；供产品负责人使用的地址为 `http://192.168.5.213:3130/zh`。复用已有服务，按任务需要启动。`pnpm build` 用于生成网站交付程序，`pnpm start` 启动构建结果。

普通增量直接交付使用反馈。`pnpm test --help` 列出按安全风险选择用例的方式；测试、数据库重建、备份和演练都按具体需要调用。

## 目录

| 目录 | 内容 |
| --- | --- |
| `src/` | 网站、教学工具、课件与学校工作区 |
| `content/`、`public/` | 公开内容、字体和视觉资源 |
| `apps/`、`contracts/` | 微信、iOS、Android 家长端与共用 API |
| `supabase/migrations/` | 已执行及新增迁移的可追溯历史 |
| `scripts/` | 开发、发布、内容处理与必要风险操作 |
| `docs/` | 当前方向、事实、工作场景和操作说明 |
| `archive/` | 按日期集中保存的历史材料 |
