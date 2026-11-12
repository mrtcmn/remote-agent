import { expect, test } from 'bun:test';
import { resultOf } from './updater';

test('the last RESULT line decides the state', () => {
  expect(resultOf(['[10:00:00] Pull...'])).toBeNull();
  expect(resultOf(['x', 'RESULT: OK v1.3.2'])).toEqual({ state: 'ok', detail: 'OK v1.3.2' });
  expect(resultOf(['RESULT: ROLLED BACK the new version did not answer'])?.state).toBe('rolled-back');
  expect(resultOf(['RESULT: FAILED cannot pull'])?.state).toBe('failed');
});
