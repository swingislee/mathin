# 服务号登录配置加载

- 用户在本任务核查后自行补入生产服务号配置，随后反馈微信内登录仍提示尚未开通；本轮定位并加载已保存的配置。
- 目标：生产 `xiaomi`（`192.168.5.183`）的 `mathin.service`，环境文件 `/home/swing/services/mathin/config/.env.production.local`，网站 `https://mathin.club`。
- 原因：保存配置已有服务号 AppID、AppSecret 和 `WECHAT_OFFICIAL_ACCOUNT_ENABLED=true`，但原进程自 2026-10-14 启动，运行环境缺失这三项。保存文件与进程的全部差异恰为这三项，无重复键；服务号 AppID 与用户截图一致，密钥内容未输出。
- 处理：2026-10-15 重启当前应用服务，加载用户保存的配置。未改写环境文件、切换应用版本、修改 Auth 提供方或数据库；release 保持 `20261014-092228`，源码 commit `e7cd92165ac52bc5a3ef7d8135456c0fa0e243c4`。
- 机器检查：新进程已加载三项服务号配置，与保存值一致；服务 active，网站健康 200，小程序登录状态 `available=true`。生产公网健康、全新登录页、小程序状态接口均为 200。
- 可操作入口：手机微信内重新打开 `https://mathin.club/zh/login`，再次发起微信登录，避免继续停留在带旧错误参数的页面。
- 待用户确认：真实微信网页授权、回调及回到原 Mathin 账号。本轮未代用户授权或建立测试身份。
