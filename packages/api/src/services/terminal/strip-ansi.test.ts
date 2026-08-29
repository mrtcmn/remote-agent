import { test, expect } from 'bun:test';
import { stripAnsi } from './strip-ansi';

test('drops colour, cursor and title sequences', () => {
  expect(stripAnsi('\x1b[31mred\x1b[0m plain')).toBe('red plain');
  expect(stripAnsi('\x1b[2J\x1b[H\x1b[3;1Hmoved')).toBe('moved');
  expect(stripAnsi('\x1b]0;window title\x07shell$ ')).toBe('shell$ ');
});

test('keeps only the last write of a redrawn line', () => {
  expect(stripAnsi('10%\r50%\r100% done')).toBe('100% done');
  expect(stripAnsi('a\r\nb\r\n')).toBe('a\nb\n');
});

test('leaves plain output untouched', () => {
  expect(stripAnsi('line one\nline two')).toBe('line one\nline two');
});
