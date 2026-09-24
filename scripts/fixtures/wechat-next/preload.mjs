// 子进程专用：只把微信上游请求送到本机协议替身。产品源码不提供 mock 开关。
import https from 'node:https';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
if (process.env.MATHIN_NEXT_FIXTURE !== '1') throw new Error('NEXT_FIXTURE_REQUIRED');
const origin = new URL(process.env.MATHIN_FIXTURE_GATEWAY);
if (origin.protocol !== 'https:' || origin.hostname !== '127.0.0.1' || !origin.port) throw new Error('LOOPBACK_FIXTURE_REQUIRED');
const original = https.request;
const ca = fs.readFileSync(process.env.MATHIN_FIXTURE_CA);
https.request = function (input, options, callback) {
  if (input instanceof URL && input.origin === 'https://api.weixin.qq.com') {
    const url = new URL('/mock/wechat' + input.pathname + input.search, origin);
    return original.call(this, url, { ...options, ca }, callback);
  }
  return original.apply(this, arguments);
};
syncBuiltinESMExports();
