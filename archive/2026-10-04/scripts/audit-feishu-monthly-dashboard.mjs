import { readDashboardArchive, evaluateDashboardRange, describeDashboardFilter } from './lib/feishu-dashboard-audit.mjs';

// 只重算完整月份的 COUNTA 总量卡片；其他图表需要各自的聚合与日期上下文。
const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/audit-feishu-monthly-dashboard.mjs <archive.base>');
const archive = readDashboardArchive(file);
const result = [];
for (const [folder, month, visit] of [
  ['12月仪表盘-2025', '12', '到访仪表盘-12月'],
  ['1月仪表盘-2026', '1', '选拔到访仪表盘-1月'],
]) {
  for (const [name, metrics] of [[visit, ['报名', '到访', '诺访']], [`获客私域仪表盘-${month}月`, ['获客数', '确认加V数']]]) {
    const boards = archive.dashboards.filter(d => d.folder === folder && d.name === name);
    if (boards.length !== 1) throw new Error('EXPECTED_ONE_MONTHLY_DASHBOARD');
    const board = boards[0];
    if (board.filters.length) throw new Error('GLOBAL_FILTER_REQUIRES_EVALUATION');
    for (const metric of metrics) {
      const charts = board.charts.filter(c => c.name === `${month}月${metric}`);
      if (charts.length !== 1 || charts[0].ranges.length !== 1) throw new Error('EXPECTED_ONE_MONTHLY_RANGE');
      const range = charts[0].ranges[0];
      if (range.dataCondition.seriesArray !== 'COUNTA' || range.multiIndicatorConditions?.length) throw new Error('EXPECTED_SIMPLE_COUNTA');
      const value = evaluateDashboardRange(archive, range);
      result.push({ folder, dashboard: name, metric, count: value.count, filter: describeDashboardFilter(archive, value.tableId, value.filter) });
    }
  }
}
console.log(JSON.stringify({ sourceSha256: archive.sha256, cards: result }, null, 2));
