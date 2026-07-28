import { useEffect, useId, useRef, useState } from 'react';

// ponytail: mermaid (~500KB) is dynamic-imported so it stays out of the main bundle
// and only loads when a slide actually ships a diagram.
let mermaidReady: Promise<typeof import('mermaid').default> | null = null;

function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: 'dark', // matches the review drawer's hardcoded dark diffs
        securityLevel: 'strict',
        flowchart: { htmlLabels: true, curve: 'basis' },
      });
      return m.default;
    });
  }
  return mermaidReady;
}

/**
 * Renders a mermaid diagram source string. Supplementary content: on parse
 * error it renders nothing rather than showing a broken box.
 */
export function MermaidDiagram({ source }: { source: string }) {
  const [svg, setSvg] = useState('');
  const rawId = useId();
  // mermaid ids must be valid CSS selectors — strip React's colons.
  const id = `mmd-${rawId.replace(/:/g, '')}`;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        const mermaid = await loadMermaid();
        const { svg } = await mermaid.render(id, source);
        if (mounted.current) setSvg(svg);
      } catch (err) {
        console.warn('[MermaidDiagram] failed to render, hiding:', err);
        if (mounted.current) setSvg('');
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, [id, source]);

  if (!svg) return null;

  return (
    <div className="border-t border-border px-4 py-4 flex justify-center overflow-x-auto">
      {/* svg is produced by mermaid with securityLevel 'strict' (DOMPurify-sanitized) */}
      <div className="[&_svg]:max-w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
