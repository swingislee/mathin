# Mathin

Mathin 是一个中英双语、以 Terms 为核心的数学探索网站。小王子世界观是全站主要视觉语言：公开首页使用 B-612/五星球场景，内容与 Notebook 使用绘本/旅途笔记语法，运营工作区保留纸色、星夜、书卷字体和克制的品牌锚点。1.0 同时交付 Story、Games、Minds、Terms、Tools、Notebook，以及 `/dashboard` 下的学校运营与内容发布系统。UI 永远维护 zh/en；英文课程和文章内容可在明确回退的前提下延后。

当前处于 **R1-Live-1 · 正式身份与真实数据**。首个内部生产闭环固定为：正式教师进入自己的 production 班级/课次，完成整班点名，刷新和重登后仍可读取，管理员可见且无权限主体不可见。原 R1 暂停在 R1-9，P6-AIX-2 和 1305 讲来源合同结果保留；全量课件/公开模块/视觉/E2E/恢复门进入 R1-Live 后的 Production 1.0 队列。SML-0 独立并行，不阻塞首次真实使用。规划入口：

- [00 总览与信息架构](docs/plan/00-overview.md)：产品宪章、文档状态和冲突裁决；
- [04 分期路线图](docs/plan/04-roadmap.md)：R1-Live Gate、唯一当前阶段、首个教师闭环和旧 R1 重新定位；
- [25 生产 1.0 产品完整性](docs/plan/25-production-1.0-product-completeness.md)：R1-Live 后的成熟度证据、量化硬门和受保护生产初始化。
- [R1 证据索引](docs/evidence/r1/README.md)：R1-Live 差距表、阶段关闭记录，以及 CI artifact/受控对象存储中的大日志、截图和视频索引。

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
pnpm test             # 全量诊断；当前提交态 90 文件、595 项通过、1 项条件跳过
pnpm r1:test          # R1 定向合同；21 文件、156/156 通过
pnpm secrets:check    # 当前跟踪树与 binary ASCII 高置信 secret 扫描
pnpm secrets:history  # 完整可达 Git 历史 high-confidence secret 扫描
pnpm e2e              # 本地/开发目标 Playwright；固定账号从 Git 忽略文件读取
pnpm e2e:release      # 仅在明确非生产 target attestation 下运行的 fail-closed 发布套件
```

R1-Live 开始前登记唯一 admin 角色账号，随后按正式身份清单增加真实教师和业务用户。真实班级、课次、学生、点名及课次引用的 immutable release/snapshot/object 一经产生即受保护，任何测试清理都不得触达。Production 1.0 仍会在隔离副本演练显式测试数据清理，并完整保留 E 系列 1135 讲与爱学习 G+/X+/A+ 秋季 170 讲的 16:9/4:3 资源，为 1305 个 lecture 的两条轨道建立 2610 条 baseline `release_no=1`；旧“生产只留一个 auth 用户”的 planner 在增加正式对象保护 manifest 前不可执行。

自托管 Supabase 的配置、备份和上线注意事项见 [docs/supabase-self-hosting.md](docs/supabase-self-hosting.md)。
