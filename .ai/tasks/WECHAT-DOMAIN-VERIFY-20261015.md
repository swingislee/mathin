# 微信网站应用与公众号域名校验文件

- 本次授权：产品负责人提供 `G2CL3p5ltT.txt` 与 `MP_verify_tOvCBDAHxJOx1BKU.txt`，要求放到 `mathin.club` 后台；微信平台校验由产品负责人自行完成。
- 范围：两个精确根路径的公开纯文本响应及对应 `public/` 文件；现有业务、登录配置和其他校验文件保持原状。
- 负责文件：`public/G2CL3p5ltT.txt`、`public/MP_verify_tOvCBDAHxJOx1BKU.txt`、本任务卡、任务登记中的本任务条目。运行配置为 `/home/swing/services/caddy-supabase/Caddyfile` 的 `mathin.club` 站点。
- 已核对生产目标：SSH `xiaomi` → `192.168.5.183`，用户 `swing`，入口容器 `caddy-supabase`；网站监听 `127.0.0.1:3131`，服务 active，当前 release `20261014-092228`。
- 原文件已逐字节复制到源码：`G2CL3p5ltT.txt` 为 32 字节，SHA-256 `813a7ab6dfeec6f1849d65c13d91c0749d2f5895497d7a16e9752019e4940eee`；`MP_verify_tOvCBDAHxJOx1BKU.txt` 为 16 字节，SHA-256 `b39597773bf5b277e8b95d92273a8eafd1aea4d9ca817851ac72e9fb1a76ce6b`。文件内容为有意公开的域名归属校验值。
- 当前状态：2026-10-15 已在生产增加两个精确路径响应并平滑加载，源码保留原始 public 文件供后续发布携带。
- 实际检查：候选 Caddy 配置有效，移除本次两条路径后编译配置与原配置等价；生产本机 HTTPS/TLS 1.2 响应均与原文件逐字节一致。客户端从当前网络直连域名，两个路径均为 200、零跳转、`text/plain; charset=utf-8`、`Cache-Control: no-store`，长度及 SHA-256 一致，证书校验通过。
- 既有服务状态：网站健康 200，Supabase Auth 未认证响应保持 401，网站服务 active；应用 release 保持 `20261014-092228`。未修改登录凭据、数据库或微信平台设置。
- 运行配置 SHA-256：`c0590f6c475b4dc71326dfae441f24c040ec859d547c2b0788e6b0e51f8667fd`。原配置与操作回执保存在生产 `/home/swing/services/caddy-supabase/.tmp/wechat-domain-verify-20261015/`。
- 待确认：负责人自行在微信平台提交、完成域名校验；本任务不操作平台保存。
