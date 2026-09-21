// 复制为 config.local.ts；当前页面外壳不发起网络请求。
// 本机联调时填写开发服务 origin，后续接口适配器从这里读取。
export const config = {
  apiOrigin: "",
} as const;
