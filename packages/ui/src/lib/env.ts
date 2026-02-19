export function env(key: string): string | undefined {
  return (window as any).__ENV__?.[key] ?? (import.meta.env as any)[key];
}
