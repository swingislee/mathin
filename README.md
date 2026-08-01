# Mathin

Mathin 是一个中英双语、以 Terms 为核心的数学探索网站。小王子世界观是全站主要视觉语言：公开首页使用 B-612/五星球场景，内容与 Notebook 使用绘本/旅途笔记语法，运营工作区保留纸色、星夜、书卷字体和克制的品牌锚点。1.0 同时交付 Story、Games、Minds、Terms、Tools、Notebook，以及 `/dashboard` 下的学校运营与内容发布系统。UI 永远维护 zh/en；英文课程和文章内容可在明确回退的前提下延后。

当前处于 **R1-8 · 财务正式闭环或安全关闭**。R1-0～R1-4 已于 2026-07-28 关闭，R1-5 已于 2026-07-31 关闭，R1-6～R1-7 已于 2026-08-01 关闭。规划入口：

- [00 总览与信息架构](docs/plan/00-overview.md)：产品宪章、文档状态和冲突裁决；
- [04 分期路线图](docs/plan/04-roadmap.md)：唯一当前阶段与 R1 顺序；
- [25 生产 1.0 产品完整性](docs/plan/25-production-1.0-product-completeness.md)：成熟度证据、缺口、量化发布门和生产初始化。
- [R1 证据索引](docs/evidence/r1/README.md)：阶段关闭记录，以及 CI artifact/受控对象存储中的大日志、截图和视频索引。

其他 01～24 文档先看顶部状态头：`complete` 是历史竣工记录，不代表应按旧清单返工；`partial` 的剩余项以 04/25 重新收录为准。

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
pnpm plan:audit
pnpm exec vitest run # 全量诊断；当前已知 16 项历史合同测试待 R1-14 清零
```

正式 1.0 发布前会在隔离副本演练数据初始化：生产最终仅保留唯一管理员，清除测试账号、班级、订单及依赖运营数据；完整保留 E 系列 865 讲的 16:9/4:3 资源，并把两条轨道固化为各讲 `release_no=1`。除规划规定的演练/发布阶段和人工授权外，不得执行该清理。

自托管 Supabase 的配置、备份和上线注意事项见 [docs/supabase-self-hosting.md](docs/supabase-self-hosting.md)。
