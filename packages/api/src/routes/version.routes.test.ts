import { expect, test } from 'bun:test';
import { isNewerVersion } from './version.routes';

test('isNewerVersion', () => {
  expect(isNewerVersion('v1.2.0', 'v1.3.0')).toBe(true);
  expect(isNewerVersion('1.3.0', 'v1.3.0')).toBe(false);
  expect(isNewerVersion('v1.10.0', 'v1.9.0')).toBe(false);
  // Non-release builds never nag.
  expect(isNewerVersion('dev', 'v1.3.0')).toBe(false);
  expect(isNewerVersion('dev-1d80a28', 'v1.3.0')).toBe(false);
  expect(isNewerVersion('latest', 'v1.3.0')).toBe(false);
  expect(isNewerVersion('v1.2.0', 'nightly')).toBe(false);
});
