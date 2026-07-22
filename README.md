# Mathin

Mathin 是一个中英双语数学探索网站，包含故事、游戏、思维、知识、工具、教室、笔记和画板。学校端后台（`/dashboard`）面向教师/教务/教研/学辅等员工角色，默认首页是按紧急程度和责任整理工作项的"今日工作"，权威规划见 `docs/plan/19-p4i-final.md`。

## 本地开发

1. 复制 `.env.example` 为 `.env.local`，填写自托管 Supabase 的 publishable key。
2. 安装依赖并启动：

```bash
pnpm install
pnpm dev
```

局域网访问地址：<http://192.168.5.213:3130>。

## 检查

```bash
pnpm lint
pnpm typecheck
pnpm build
```

自托管 Supabase 的配置、备份和上线注意事项见 [docs/supabase-self-hosting.md](docs/supabase-self-hosting.md)。
