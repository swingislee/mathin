# 家长端工程入口

本目录承载微信原生小程序、SwiftUI iOS 和 Kotlin/Compose Android 工程。范围为家长选课查看、错题查看和每日作业；课堂 renderer 留在现有网页。

- 各端独立构建。网页的 React、shadcn、Cookie 和 Server Action 约束用于网页实现；原生界面使用对应平台的组件与无障碍能力。
- 数据、账号主体和权限沿用根目录规则。受保护接口由服务端核验登录身份、亲子关系与 RLS；客户端通过版本化 HTTP 接口接入。
- 共用接口入口为 `contracts/parent-api/README.md`；只把已实现的接口写入 OpenAPI paths。
- 默认离线运行页面外壳。本机 API 地址使用各端忽略的本地配置；签名材料与服务端密钥不进入客户端或仓库。
- 文案同时维护 zh/en，颜色集中在各端主题资源，取值沿用 doc 01。基础系统字体用于此轮工程外壳，品牌字体和最终视觉在后续验收增量中落地。
- 窄检查入口：根目录 `pnpm parents:check`。Android 使用 Gradle Wrapper，iOS 使用共享 Xcode scheme。机器静态检查与目标平台构建、人工验收分别记录。
