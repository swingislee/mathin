/**
 * P4I §2.7：对象上下文镜头——同一对象从不同业务入口进入时的默认展示/信息优先级。
 * 只决定默认展示，不扩大权限、不复制页面。通过受控 query/route state 传递，
 * 不写入任何权限表（区别于 src/lib/environment.ts 的"使用环境"）。
 *
 * 本文件目前只建立契约，尚无消费方：讲次/课程产品/班级/课次工作区（P4I-9～15）
 * 落地时再各自读取、校验并接线，不在本任务改动任何现有页面。
 */
export type ContextLens =
  | "production" // 课程研发：从研发任务进入讲次
  | "teaching" // 当前教学使用：从课次进入讲次
  | "management" // 管理审阅：主管/教务查看
  | "support" // 学辅服务：客勤/通知/回访
  | "family" // 家庭可见：家长视角
  | "learning"; // 学生学习：学生视角

const CONTEXT_LENS_VALUES: readonly ContextLens[] = [
  "production",
  "teaching",
  "management",
  "support",
  "family",
  "learning",
];

export function parseContextLens(value: string | string[] | undefined): ContextLens | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return CONTEXT_LENS_VALUES.find((lens) => lens === raw);
}
