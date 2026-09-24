# 固定原版运行层，只替换由同一 commit + 本目录补丁构建的 Auth 二进制。
FROM supabase/gotrue@sha256:385184459f57569c54c25209f51f3b2be99ddd7c4ce9e3555b5d3eea8447b7cf
USER root
COPY --chmod=0755 auth /usr/local/bin/auth
USER supabase
