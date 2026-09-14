import { isDeepStrictEqual } from 'node:util';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** 仅合并来源实际变化的字段；生产独立修订保留并返回冲突路径。数组作为完整字段核对。 */
export function mergeSourceIncrement(before, incoming, production) {
  const conflicts = [];
  function merge(old, next, actual, path) {
    if (isDeepStrictEqual(old, next) || isDeepStrictEqual(actual, next)) return actual;
    if (isDeepStrictEqual(actual, old)) return structuredClone(next);
    if (object(old) && object(next) && object(actual)) {
      const result = structuredClone(actual);
      for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
        const value = merge(old[key], next[key], actual[key], [...path, key]);
        if (value === undefined) delete result[key];
        else result[key] = value;
      }
      return result;
    }
    conflicts.push(path.join('.'));
    return actual;
  }
  return { value: merge(before, incoming, production, []), conflicts };
}
