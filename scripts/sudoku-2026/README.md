# 数独教学 2026 版生成与复核

本课程是独立正式课程，使用 `sudoku-authored-v3` 原生游戏组件。题库、方法证据、教师材料在 `content/courses/sudoku-2026/`。

```powershell
node scripts/sudoku-2026/generate.mjs
node scripts/sudoku-2026/audit.mjs
node scripts/sudoku-2026/build.cjs
node scripts/sudoku-2026/materials.mjs
```

`generate.mjs` 使用固定种子，并缓存逐题结果在 `.tmp/sudoku-2026/bank-cache/`。`audit.mjs` 重新逐题检查方法进度、单目标性、唯一解和必用性。`build.cjs` 调用实际应用校验器，再用原生求解器独立核对每个目标格与答案，输出 `.tmp/sudoku-2026/course-package.json`。

仅调整版面、题目内容和原生求解代码未变化时，可使用 `build.cjs --reuse-audit` 复用相同 payload hash 的原生全空格证明。原生校验器仍重新执行；不在求解代码变更后使用此选项。

四宫结论可独立重跑 `node scripts/sudoku-2026/check-four.mjs`。它枚举首行规范终盘所覆盖的所有部分盘面，以数字重命名等价覆盖其余情况；报告的盘面数量是代表数。

本地导入使用 `node scripts/sudoku-2026/import-local.mjs --apply`。脚本核对 Windows 主机、开发 origin、监听进程、容器网络和数据库指纹，复用已有固定开发管理员，整批事务新增。三个课程均按用户确认设置为全年；只有显式全年模式可以不挂季节，现有学期课程仍须填写季节。已存在课程时拒绝重复导入，后续改课应使用既有课程身份。脚本不支持生产目标、不删除已有资源、不发布冻结版本。

本批次已保存 12 讲、239 页，两个轨道共 478 份文档与源包逐一一致。题库 182 道：98 个单目标方法题、36 个课堂完整题、48 个课后完整题。机器审核不替代真实课堂节奏与交互验收。
