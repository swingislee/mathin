# content/en

英文正文放这里：`en/terms/<slug>.mdx`、`en/minds/<slug>.mdx`，文件名（slug）必须与 `content/zh/` 下的同名文件一致。

**英文文件只覆写展示层**——`title`、`summary`、正文、`quiz`。结构字段（`uid`、`deps`、`minds`、`stage`、`order`、`planet`、`island`、`pathOrder`）一律以中文骨架为准，不必也不该在英文文件里重复：uid 是语言中立的锚点，图谱与编号跨语言共享（docs/plan/15-§3.1）。

缺哪一篇，`/en` 就回退显示中文原文并在页面上显式标注；同时该篇的 canonical 指回中文地址、不产出 hreflang、sitemap 也只登记中文 URL——**不谎报有英文版**（§2.4 / §10.3）。补上一篇英文 MDX，这三处会自动跟着变，无需改代码。

新概念的英文名先在 `content/glossary.json` 登记（受控术语表，`pnpm p4e:audit` 会拦）。
