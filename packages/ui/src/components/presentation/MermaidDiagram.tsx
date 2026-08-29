import { useEffect, useRef, useState, type ReactNode } from 'react';

let diagramSeq = 0;
const nextDiagramId = () => ++diagramSeq;

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

// mermaid.render() mutates shared module state, so two diagrams mounting in the
// same tick corrupt each other and both come back empty. One queue, one render
// at a time. A page with several diagrams depends on this.
let renderQueue: Promise<unknown> = Promise.resolve();

function renderSerial(id: string, source: string): Promise<{ svg: string }> {
  const next = renderQueue.then(async () => {
    const mermaid = await loadMermaid();
    return mermaid.render(id, source);
  });
  // Keep the chain alive even when one diagram fails to parse.
  renderQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Renders a mermaid diagram source string. Supplementary content: on parse
 * error it renders `fallback`, which defaults to nothing rather than showing a
 * broken box. Pass a fallback anywhere the diagram is the only content, or a
 * failure looks like a blank screen.
 */
export function MermaidDiagram({ source, fallback = null }: { source: string; fallback?: ReactNode }) {
  const [svg, setSvg] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        // A fresh id per call, never a stable one. mermaid.render() parks a
        // temporary node under this id and deletes `#id` when it finishes — so
        // reusing an id deletes the SVG an earlier call already put on screen.
        // React StrictMode runs this effect twice, which made that certain.
        const { svg } = await renderSerial(`mmd-${nextDiagramId()}`, source);
        if (mounted.current) setSvg(svg);
      } catch (err) {
        console.warn('[MermaidDiagram] failed to render, hiding:', err);
        if (mounted.current) setSvg('');
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, [source]);

  if (!svg) return <>{fallback}</>;

  return (
    <div className="border-t border-border px-4 py-4 flex justify-center overflow-x-auto">
      {/* svg is produced by mermaid with securityLevel 'strict' (DOMPurify-sanitized) */}
      <div className="[&_svg]:max-w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
