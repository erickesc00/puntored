'use client';

import { describe, expect, it } from 'vitest';
import {
  buildCurrentUrl,
  buildHrefWithReturnTo,
  sanitizeReturnTo,
} from './return-to';

describe('return-to helpers', () => {
  it('sanitizes invalid return targets to the default protected path', () => {
    expect(sanitizeReturnTo()).toBe('/references');
    expect(sanitizeReturnTo('https://malicious.example')).toBe('/references');
    expect(sanitizeReturnTo('//evil.example')).toBe('/references');
  });

  it('builds the current url with or without search params', () => {
    expect(buildCurrentUrl('/references', new URLSearchParams())).toBe('/references');
    expect(
      buildCurrentUrl('/references', new URLSearchParams('status=PENDING')),
    ).toBe('/references?status=PENDING');
  });

  it('preserves encoded returnTo values when building links', () => {
    expect(
      buildHrefWithReturnTo('/references/ref-1', '/references?status=PENDING'),
    ).toBe('/references/ref-1?returnTo=%2Freferences%3Fstatus%3DPENDING');
  });
});
