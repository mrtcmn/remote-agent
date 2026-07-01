import { Component, type ReactNode, useMemo } from 'react';
import { File } from '@pierre/diffs/react';
import { cn } from '@/lib/utils';
import { DIFF_THEME } from '@/lib/constants';
import { tokenizeFormattedText } from '@/lib/format-text';

interface FormattedTextProps {
  text: string;
  /**
   * Compact renders everything inline (block code collapsed to inline) so a
   * parent `line-clamp-*` still works. Used for the dense inbox preview.
   */
  compact?: boolean;
  className?: string;
}

const inlineCodeClass =
  'rounded bg-foreground/[0.07] px-1 py-px font-mono text-[0.85em] text-foreground/90';

// Map a fenced-block language to a filename whose extension drives Shiki's
// language detection inside the <File> highlighter. Unknown → plain text.
const LANG_EXT: Record<string, string> = {
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', console: 'sh',
  js: 'js', javascript: 'js', jsx: 'jsx',
  ts: 'ts', typescript: 'ts', tsx: 'tsx',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  py: 'py', python: 'py', rb: 'rb', go: 'go', rs: 'rs', rust: 'rs',
  java: 'java', c: 'c', cpp: 'cpp', php: 'php', sql: 'sql',
  html: 'html', css: 'css', md: 'md', markdown: 'md',
  diff: 'diff', dockerfile: 'dockerfile', xml: 'xml',
};

function langToFilename(lang?: string): string {
  const key = lang?.toLowerCase();
  const ext = key ? (LANG_EXT[key] ?? key) : 'txt';
  return `snippet.${ext}`;
}

/**
 * Syntax-highlighted code block using the same `@pierre/diffs` highlighter as
 * the git preview, stripped to the bare code (no line numbers, no file header).
 * Falls back to a plain monospaced block if highlighting throws.
 */
class CodeBlock extends Component<{ lang?: string; value: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render(): ReactNode {
    const { lang, value } = this.props;
    if (this.state.failed) {
      return (
        <pre className="overflow-x-auto p-2.5 font-mono text-foreground/80">
          <code>{value}</code>
        </pre>
      );
    }
    return (
      <File
        file={{ name: langToFilename(lang), contents: value }}
        options={{
          theme: DIFF_THEME,
          disableLineNumbers: true,
          disableFileHeader: true,
          overflow: 'wrap',
        }}
      />
    );
  }
}

/**
 * Renders notification text with inline code (`code`), **bold**, and fenced
 * code blocks (```lang … ```). Blocks are syntax-highlighted; everything else
 * is lightly styled.
 */
export function FormattedText({ text, compact = false, className }: FormattedTextProps) {
  const tokens = useMemo(() => tokenizeFormattedText(text), [text]);

  if (compact) {
    return (
      <span className={cn('break-words', className)}>
        {tokens.map((token, i) => {
          if (token.type === 'text') return <span key={i}>{token.value}</span>;
          if (token.type === 'bold')
            return (
              <strong key={i} className="font-medium text-foreground/90">
                {token.value}
              </strong>
            );
          // inline + codeblock both render inline; collapse block newlines
          return (
            <code key={i} className={inlineCodeClass}>
              {token.type === 'codeblock' ? token.value.replace(/\s*\n\s*/g, ' ') : token.value}
            </code>
          );
        })}
      </span>
    );
  }

  return (
    <div className={cn('whitespace-pre-wrap break-words', className)}>
      {tokens.map((token, i) => {
        if (token.type === 'text') return <span key={i}>{token.value}</span>;
        if (token.type === 'bold')
          return (
            <strong key={i} className="font-medium text-foreground">
              {token.value}
            </strong>
          );
        if (token.type === 'code')
          return (
            <code key={i} className={inlineCodeClass}>
              {token.value}
            </code>
          );
        return (
          <div
            key={i}
            className="my-1 overflow-hidden rounded-md [&_pre]:!my-0 [&_pre]:!py-2 [&_pre]:!text-[11px] [&_pre]:!leading-[1.45]"
          >
            <CodeBlock lang={token.lang} value={token.value} />
          </div>
        );
      })}
    </div>
  );
}
