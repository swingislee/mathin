import { z } from "zod";

/** PostgreSQL UUID 的规范字符串；既有导入主键可使用任意版本/变体位，授权仍由业务 scope 与 RLS 校验。 */
export const databaseUuid = z.guid();
