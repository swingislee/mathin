# 微信业务域名校验文件

- 本次授权：产品负责人提供 `us6QJi226o.txt` 并要求配置生产网页；范围为 `https://mathin.club/us6QJi226o.txt` 的公开校验响应。
- 分支与负责文件：`main`；`public/us6QJi226o.txt`、本任务卡和任务登记中的本任务条目。运行配置为 Xiaomi 的 `/home/swing/services/caddy-supabase/Caddyfile` 中 `mathin.club` 的精确路径。
- 已核对目标：SSH `xiaomi` → `192.168.5.183`，主机名 `xiaomi`；入口容器 `caddy-supabase`，网站进程监听 `127.0.0.1:3131`。
- 原始文件：32 字节，无 BOM、无尾部换行；SHA-256 `d1b26d9238c1d20707f0038ee97cca42254d7e3929044a07040958fbb1350ce1`。该字符串为有意公开的域名归属校验内容。
- 实现：在 Caddy 对该精确路径返回原文件内容，状态 200、`text/plain; charset=utf-8`、`Cache-Control: no-store`；源码保留逐字节一致的 public 文件，后续应用发布继续携带。
- 当前状态：2026-10-13 已配置生产并平滑加载；`https://mathin.club/us6QJi226o.txt` 可直接访问。平台点击校验与业务验收尚待产品负责人完成。
- 实际检查：Caddy 候选校验通过，除精确校验路径外编译配置等价；原配置保存于 `/home/swing/services/caddy-supabase/.tmp/wechat-domain-verify-20261013/Caddyfile.before`（私有权限）。生产本机 HTTPS 与 TLS 1.2 读取均逐字节一致；客户端经当前网络访问域名得到 200、32 字节、零跳转、正确纯文本类型和 `no-store`，证书验证通过，耗时 0.112 秒。独立网页抓取工具未能读取该地址，不作为公网多地域可达证据。
- 服务状态：网站健康接口保持 200，未认证 Supabase Auth 路径保持原有 401，网站服务保持 active；应用 release 与 commit 保持原值。运行配置 SHA-256 为 `040aa21fdf66d8f74a089249576202ff3a6b66f2218c91963a90c6650b1be607`。
- 生产应用基线：release `20261011-103921`，commit `68b7b26869c27cf080a0e83df6548298ab681f11`。本次只增加域名校验响应。
- 待确认：在微信业务平台对 `mathin.club` 点击校验；平台通过与网页可访问分别记录。若平台要求特定子目录，按平台实际路径补充精确响应。
