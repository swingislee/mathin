# 微信原生家长端

使用原生 TypeScript、WXML、WXSS；不依赖 React 或网页运行时。

1. 在仓库根目录运行 `corepack pnpm install --frozen-lockfile`。
2. 微信开发者工具选择“导入项目”，目录指向当前文件夹（包含 project.config.json）。
3. 默认 `touristappid` 用于无账号业务的本地工程预览；如工具要求 AppID，填写开发者平台已注册且有开发权限的小程序 AppID。
4. 使用工具内置 TypeScript 编译，打开四个底部入口查看外壳。无需启动 Next.js 或 Supabase。

文案跟随微信语言：英文使用 en，其他语言回退中文；每次进入页面同步原生标题与 tabBar。主题跟随系统外观。

```sh
corepack pnpm parents:wechat:typecheck
```

当前不读取 API 配置。后续联调可将 `miniprogram/config.example.ts` 复制为 `config.local.ts` 并填写开发 origin；该文件已忽略。正式网络接入时配置合法 HTTPS 请求/上传域名；局域网 HTTP 仅在开发者工具的本地调试设置中使用。项目默认保留域名校验。

开发者工具生成的 JS、source map 和 project.private.config.json 不提交。
