import { describe, expect, it } from 'vitest';
import { updateProgress } from './updates';

describe('update download progress', () => {
  it('supports servers without a content length and clamps invalid progress', () => {
    expect(updateProgress({ downloaded: 1048576, total: null })).toEqual({ percent: undefined, label: '已下载 1.0 MB' });
    expect(updateProgress({ downloaded: 300, total: 200 }).percent).toBe(100);
    expect(updateProgress({ downloaded: -1, total: 200 }).percent).toBe(0);
    expect(updateProgress({ downloaded: NaN, total: Infinity }).percent).toBeUndefined();
  });
});
