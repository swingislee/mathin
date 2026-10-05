import { describe, expect, it } from 'vitest';
import { mergeGeneratedDatabaseTypes } from '../scripts/lib/scoped-database-types.mjs';

const source = (tables: string, functions = '') => `export type Database = {
  public: {
    Tables: {${tables}
    }
    Functions: {${functions}
    }
  }
}
`;

describe('database-generated scoped types', () => {
  it('inserts multiple generated members in order while keeping unrelated definitions', () => {
    const current = source('\n      accounts: { Row: { id: string } }\n      z_other: { Row: { legacy: true } }');
    const generated = source('\n      accounts: { Row: { changed: number } }\n      wechat_a: { Row: { payload: unknown } }\n      wechat_b: { Row: { id: string } }');
    const output = mergeGeneratedDatabaseTypes(current, generated, { Tables: ['wechat_b','wechat_a'] });
    expect(output).toContain('accounts: { Row: { id: string } }');
    expect(output).toContain('z_other: { Row: { legacy: true } }');
    expect(output.indexOf('wechat_a:')).toBeLessThan(output.indexOf('wechat_b:'));
    expect(output.indexOf('wechat_b:')).toBeLessThan(output.indexOf('z_other:'));
    expect(mergeGeneratedDatabaseTypes(output, generated, { Tables: ['wechat_b','wechat_a'] })).toBe(output);
  });
  it('handles an empty section and replaces only requested members', () => {
    const current = source('', '\n      existing: { Args: never; Returns: number }');
    const generated = source('\n      wechat: { Row: { id: string } }', '\n      existing: { Args: never; Returns: string }');
    const output = mergeGeneratedDatabaseTypes(current, generated, { Tables: ['wechat'], Functions: ['existing'] });
    expect(output).toContain('wechat: { Row: { id: string } }');
    expect(output).toContain('Returns: string');
    expect(output).not.toContain('Returns: number');
  });
  it('rejects missing or ambiguous scope and malformed generated input', () => {
    expect(() => mergeGeneratedDatabaseTypes(source(''), source(''), { Tables: ['absent'] })).toThrow('MEMBER_MISSING');
    expect(() => mergeGeneratedDatabaseTypes(source(''), source(''), { Tables: ['a','a'] })).toThrow('DUPLICATE');
    expect(() => mergeGeneratedDatabaseTypes(source(''), 'export type Database = {', { Tables: ['a'] })).toThrow('INVALID');
  });
});
