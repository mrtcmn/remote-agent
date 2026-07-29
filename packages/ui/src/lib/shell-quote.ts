// Quote a path for a POSIX shell — spaces, parens, `&`, quotes and the rest of
// the punctuation that shows up in real Desktop filenames all need it.
export function shellQuote(p: string): string {
  return /^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.split("'").join(`'\\''`)}'`;
}
