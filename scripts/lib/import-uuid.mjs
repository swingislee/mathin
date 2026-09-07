import { createHash } from 'node:crypto';

const format = hex => `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;

/** 新记录使用确定性的 UUIDv8；已落库的旧主键继续复用，重导保持全部外键关联。 */
export function createImportUuid(existingIds = []) {
  const existing = new Set(existingIds);
  return key => {
    const bytes = createHash('md5').update(key).digest();
    const legacy = format(bytes.toString('hex'));
    if (existing.has(legacy)) return legacy;
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return format(bytes.toString('hex'));
  };
}
