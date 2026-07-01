import { describe, expect, test } from 'bun:test';
import { tokenizeFormattedText } from './format-text';

describe('tokenizeFormattedText', () => {
  test('returns empty array for empty input', () => {
    expect(tokenizeFormattedText('')).toEqual([]);
  });

  test('plain text is a single text token', () => {
    expect(tokenizeFormattedText('just a recap')).toEqual([{ type: 'text', value: 'just a recap' }]);
  });

  test('inline code is split out', () => {
    expect(tokenizeFormattedText('run `npm test` now')).toEqual([
      { type: 'text', value: 'run ' },
      { type: 'code', value: 'npm test' },
      { type: 'text', value: ' now' },
    ]);
  });

  test('multiple inline code spans', () => {
    const tokens = tokenizeFormattedText('`a` and `b`');
    expect(tokens).toEqual([
      { type: 'code', value: 'a' },
      { type: 'text', value: ' and ' },
      { type: 'code', value: 'b' },
    ]);
  });

  test('fenced block with language', () => {
    expect(tokenizeFormattedText('```bash\nrm -rf node_modules\n```')).toEqual([
      { type: 'codeblock', lang: 'bash', value: 'rm -rf node_modules' },
    ]);
  });

  test('fenced block without language', () => {
    expect(tokenizeFormattedText('```\nplain\n```')).toEqual([
      { type: 'codeblock', lang: undefined, value: 'plain' },
    ]);
  });

  test('preserves multi-line block bodies', () => {
    const tokens = tokenizeFormattedText('```ts\nconst a = 1;\nconst b = 2;\n```');
    expect(tokens).toEqual([{ type: 'codeblock', lang: 'ts', value: 'const a = 1;\nconst b = 2;' }]);
  });

  test('mixes text, inline code and a block', () => {
    const tokens = tokenizeFormattedText('Done. Run `bun test`, then:\n```bash\nbun run build\n```');
    expect(tokens).toEqual([
      { type: 'text', value: 'Done. Run ' },
      { type: 'code', value: 'bun test' },
      { type: 'text', value: ', then:\n' },
      { type: 'codeblock', lang: 'bash', value: 'bun run build' },
    ]);
  });

  test('bold is split out', () => {
    expect(tokenizeFormattedText('this is **important** ok')).toEqual([
      { type: 'text', value: 'this is ' },
      { type: 'bold', value: 'important' },
      { type: 'text', value: ' ok' },
    ]);
  });

  test('mixes bold and inline code', () => {
    expect(tokenizeFormattedText('**Note:** run `bun test`')).toEqual([
      { type: 'bold', value: 'Note:' },
      { type: 'text', value: ' run ' },
      { type: 'code', value: 'bun test' },
    ]);
  });

  test('asterisks inside inline code stay literal', () => {
    expect(tokenizeFormattedText('`**x**`')).toEqual([{ type: 'code', value: '**x**' }]);
  });

  test('a lone unmatched backtick stays plain text', () => {
    expect(tokenizeFormattedText('a ` b')).toEqual([{ type: 'text', value: 'a ` b' }]);
  });

  test('an unterminated fence stays plain text', () => {
    const input = '```bash\nrm -rf';
    expect(tokenizeFormattedText(input)).toEqual([{ type: 'text', value: input }]);
  });
});
