# TUS 大文件上传（部署已完成，待浏览器验收）

准备 10–20 MiB 文件，使用登录用户在浏览器上传并记录以下请求：

```text
POST  https://supabase.mathin.club/storage/v1/upload/resumable
PATCH https://supabase.mathin.club/storage/v1/upload/resumable/...
HEAD  https://supabase.mathin.club/storage/v1/upload/resumable/...
```

验收：创建为典型 `201`、分片为典型 `204`，首次响应的 `Location` 以 `https://supabase.mathin.club/storage/v1/upload/resumable/` 开头，且绝不含 `localhost`、`192.168.5.183`、`:8000` 或 `http://`。

若此前测试过错误的外部 URL，先清除该站点浏览器存储和旧 TUS fingerprint，再重新上传。还需同时观察 Sakura 流量：内网 DNS 分流后，内网上传不应显著增加 Supabase 隧道流量。
