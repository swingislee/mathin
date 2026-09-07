import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createImportUuid } from '../scripts/lib/import-uuid.mjs';
import { databaseUuid } from '../src/lib/database-uuid';

describe('imported database UUIDs', () => {
  it('generates stable standard UUIDs for new records', () => {
    const id = createImportUuid();
    for (const key of ['lead:one', 'assessment:two', 'enrollment:three']) {
      expect(z.uuid().safeParse(id(key)).success).toBe(true);
      expect(id(key)).toBe(createImportUuid()(key));
      expect(id(key)[14]).toBe('8');
    }
    expect(new Set(['lead:one', 'assessment:two', 'enrollment:three'].map(id)).size).toBe(3);
  });
  it('keeps old database IDs when the import is repeated against an existing snapshot', () => {
    const key = 'lead:existing';
    const hash = createHash('md5').update(key).digest('hex');
    const old = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;
    expect(createImportUuid([old])(key)).toBe(old);
    expect(databaseUuid.parse(old)).toBe(old);
  });
});
