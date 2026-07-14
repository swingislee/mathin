import { z } from "zod";

// ---------------------------------------------------------------------------
// school actions 的入参校验原语（P4G-9 §7.2）。
// RLS 挡越权，挡不住「合法用户提交畸形数据」：负数金额、超长字符串、非法枚举、
// NaN（`Number("")` 的必然产物）此前全靠各处手写 coercion 恰好想到。这里统一收口。
// 只拒绝畸形输入，不改任何字段的业务规则。
// ---------------------------------------------------------------------------

/** 校验失败的统一错误码；UI 侧由 useAction/ActionForm 兜底翻译成「输入有误」。 */
export const VALIDATION = "VALIDATION";

/** 每个 school action 的 actionError 白名单都以这三个码打底。 */
export const COMMON_CODES = [VALIDATION, "FORBIDDEN", "UNAUTHENTICATED"] as const;

/** 校验入口：失败一律抛 VALIDATION，由各 action 的 catch 转成 { ok:false, code:"VALIDATION" }。 */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error(VALIDATION);
  return result.data;
}

export const uuid = z.uuid();
export const optionalUuid = z.uuid().nullable();

/** 可空文本：trim 后按上限拒绝（此前是静默 slice 截断）。 */
export const text = (max: number) => z.string().trim().max(max);
export const requiredText = (max: number) => z.string().trim().min(1).max(max);

/** 金额上限一百万，够覆盖单笔学费且能挡住溢出/误输；NaN 与 Infinity 由 finite 挡掉。 */
const MONEY_MAX = 1_000_000;
export const money = z.number().finite().nonnegative().max(MONEY_MAX);
/** 账户调账可正可负（充值 / 扣减）。 */
export const signedMoney = z.number().finite().min(-MONEY_MAX).max(MONEY_MAX);

export const intInRange = (min: number, max: number) => z.number().int().min(min).max(max);

/** 完整 ISO 与 `<input type="datetime-local">` 的本地串都收，统一归一化为 ISO——与整改前 Date.parse 的行为一致。 */
export const datetime = z
  .string()
  .min(1)
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());

/** `<input type="date">` 的 YYYY-MM-DD。 */
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * 搜索串：截断而非拒绝。它不入库，长度只是查询成本问题——
 * 让用户多打几个字就报「输入有误」是把校验用错了地方。
 */
export const searchQuery = z.string().max(1000).transform((value) => value.trim().slice(0, 80));
