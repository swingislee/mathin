# 格致未来思维 · 业务配置与本机验收

状态：开发端已接通本机 Supabase，待产品负责人验收视觉、交互与业务。微信使用原生 TypeScript / WXML / WXSS。生产环境尚未部署本次接口与迁移。

## 四个入口

| 用户入口 | 用户动作 | 数据来源或结果 |
| --- | --- | --- |
| 探索 → 初次见面 | 免登录填写基本信息并同意信息使用说明 | `miniapp_forms` 配置；`miniapp_intakes` 保存回答、表单快照和来源 |
| 探索 → 近期活动 | 浏览活动、登录后选择参与人预约 | `activities` + `miniapp_activity_publications`；预约写入现有 `activity_registrations` |
| 回顾 | 阅读测评结果、展开亮点和建议、查看老师反馈 | 已发送的 `assessment_reports`；已发布的课堂结果版本 |
| 练习 | 选择练习、添加照片/视频、提交、重新查看 | 现有 `assignments`；新增 `miniapp_practice_submissions` 和私有附件 |

“我的”使用已有手机号或邮箱与密码登录，显示关联参与人及预约。当前不包含微信一键登录、自助注册或自助建立家庭关系；工作人员继续使用现有后台完成档案关联。匿名登记不会自动创建正式账号或学生档案，管理员核对后按现有业务办理。

## 后台设置登记字段

当前管理入口为 Supabase Studio 的 Table Editor。打开开发库的 `public.miniapp_forms`，默认表单 `slug=welcome`。

| 列 | 设置方式 |
| --- | --- |
| `slug` | 表单稳定标识，小写字母、数字或连字符，最多 64 字符 |
| `title` / `description` / `privacy_notice` | JSON：`{"zh":"中文内容","en":"English content"}`，两种语言均填写 |
| `fields` | 字段数组，按数组顺序展示，1～20 个字段 |
| `enabled` | `true` 对外开放；`false` 关闭新登记 |
| `version` | 每次更新自动递增，通常无需手工设置 |

字段示例：

```json
[
  {
    "id": "contact_name",
    "type": "text",
    "label": {"zh": "怎么称呼你", "en": "Your name"},
    "required": true
  },
  {
    "id": "interest",
    "type": "select",
    "label": {"zh": "感兴趣的方向", "en": "Area of interest"},
    "required": false,
    "options": [
      {"id": "reasoning", "label": {"zh": "逻辑推理", "en": "Reasoning"}},
      {"id": "space", "label": {"zh": "空间想象", "en": "Spatial thinking"}}
    ]
  }
]
```

支持 `text`、`phone`、`textarea`、`select`、`multiselect`；选择型字段提供 1～30 个选项。字段与选项的 `id` 使用小写字母开头的字母、数字、下划线，最多 40 字符且同组唯一；保留键 `constructor`、`prototype` 不可用。展示名称可以修改，数据键应保持稳定。文本最多 200 字、长文本 2000 字、电话 30 字符。

表单更新后，已打开旧版表单的用户会收到重新读取提示；已提交记录保留当时的字段名称、选项、回答与同意时间。后台格式不合法时接口停止提供该表单，修正配置后可重新打开。登记记录由管理员在 `miniapp_intakes` 查看。

地推入口可以直达 `pages/register/index?form=welcome&source=campaign-202609`。`source` 用于区分渠道，最多 120 字符；微信场景参数也可作为来源记录。二维码生成、线上发布及渠道自动归因不在本次实现内。

## 发布活动、结果和练习

活动先通过原有后台创建，在 `activities` 中维护时间、地点、时长、容量；再在 `miniapp_activity_publications` 添加对应 `activity_id`，填写双语 `title`、`description`，设置 `enabled=true`。`booking_closes_at` 可提前截止，留空则到活动开始截止。只有未来、当前状态、未删除且公开的活动会进入列表。小程序预约写入原有预约表，工作人员可沿用原有活动后台处理。

测评需要在原有测评流程中确认发送，`assessment_workflow_states.sent_report_id` 指向的版本才进入“回顾”；生成草稿不会公开。老师课后反馈读取 `learning_result_heads` 的已发布 `session_review` 版本，展示最近 366 天的记录。历史结果正文保留发布语言，不在客户端自动翻译。

练习使用现有 `assignments`，标题取 `title`、说明取 `content.text`、截止时间取 `due_at`。参与人须处于相应班级的有效关联范围，可由已关联账号代为提交，参与人本人无需登录。提交以追加记录保存，重新提交保留此前记录，小程序显示最新一次；目前后台核对入口为 `miniapp_practice_submissions` 和 `miniapp_practice_uploads`，本次没有新增网页批阅页面。

## 附件与登录边界

- 每次提交 1～9 个附件；照片 ≤12 MiB，视频 ≤64 MiB；相机录制默认最多 60 秒，既有视频仍受文件大小限制。
- 支持 JPEG、PNG、WebP、HEIC、MP4、MOV。服务端依据文件签名选择 MIME；媒体预览是否支持具体编码由微信和设备决定。
- Storage bucket `miniapp-practice` 为私有，签名预览有效期 5 分钟，视频额外要求家庭关联中的 `video` 范围。正常家长操作仍需 `grades` 范围。
- 会话令牌仅存在小程序本地存储，密码在成功登录后清空；退出清除本地会话。服务端密钥只用于受限的服务端操作。
- 上传失败可重试，成功返回的附件会复用。未返回确认的上传可能留下预留文件，目前没有新增后台清理任务；核对时保留已提交业务附件。

## 本机初始化与复核

本机使用 Windows 隔离 Supabase 和 Next.js，API origin 写在已忽略的 `miniprogram/config.local.ts`。客户端只连接 Next.js API；由服务端连接本机 Supabase。固定账号沿用仓库私有清单，不创建一次性 Auth 身份。

本次两条迁移已在本机应用。全新开发库可以按以下顺序执行；脚本会核对主机、loopback origin、Docker 实际目标、端口监听和迁移摘要：

```sh
node scripts/parent-portal-local.mjs --preflight
node scripts/parent-portal-local.mjs --check
node scripts/parent-portal-local.mjs --apply
node scripts/parent-portal-local.mjs --configure
corepack pnpm parents:check
```

`--check` 在事务中检查并回滚。`--apply` 只接受匹配检查结果的待应用迁移，全部已应用时提示 `ALREADY_APPLIED`。`--configure` 仅向核实的本机库补充明确标为“开发联调”的表单、活动、结果与练习，复用固定身份并保留现有同 ID 数据。迁移命令不用于生产。

真实 HTTP 验证脚本会留下标记清楚的本机登记、附件及提交记录：

```sh
node scripts/parent-portal-http-local.mjs
```

可使用 FFmpeg 生成无个人信息的短视频，增加真实视频、Range 和签名失败验证：

```sh
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=black:s=32x32:r=10 -t 0.5 -c:v libx264 -pix_fmt yuv420p -movflags +faststart -y .tmp/parent-portal/local-check.mp4
node scripts/parent-portal-http-local.mjs --video .tmp/parent-portal/local-check.mp4
```

工具输出和验收回执在已忽略的 `.tmp/parent-portal/`。共享 `project.config.json` 保持 `urlCheck=true`；按 2026-09-22 的授权，本机 `project.private.config.json` 使用 `urlCheck=false` 连接局域网 HTTP。正式网络接入配置 HTTPS 合法域名。

## 人工验收顺序

1. 在微信开发者工具编译，打开“探索”→“初次见面”，免登录完成登记；到 Studio 核对回答和配置快照。
2. 在 Studio 修改表单展示名或选项，重新打开登记页确认变化；确认已有记录保留旧版快照。
3. 浏览“思维探索 · 开发联调”，在“我的”使用固定家长开发账号登录，选择参与人预约；回“我的”查看、取消，再观察名额。
4. 打开“回顾”，读取“思维回顾 · 开发联调”的明确测试反馈并展开建议。
5. 打开“练习”→“记录一个发现 · 开发联调”，从相册选择照片和视频，提交后退出详情再打开，确认附件可预览。
6. 使用未关联的固定开发账号确认没有其他账号的结果与练习；在真机检查相册权限、录制、播放、返回与滚动手感。

机器检查覆盖接口、权限、容量、重试与持久化；真机媒体能力、视觉和操作体验仍待人工验收。
