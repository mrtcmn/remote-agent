import { useEffect, useRef } from 'react';
import { Mic } from 'lucide-react';

// Takes over the recent-files slot while push-to-talk is held: same height and
// frame, live transcript in place of the file chips.
export function DictationBar({ transcript }: { transcript: string }) {
  const scrollRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [transcript]);

  return (
    <div className="h-8 shrink-0 flex items-center gap-2 px-2 border-b border-border">
      <span className="flex items-center gap-1 pr-2 mr-0.5 border-r border-border/60 text-[8px] font-semibold uppercase tracking-wider text-red-500 shrink-0">
        <Mic className="size-2.5 animate-pulse" />
        Listening
      </span>
      <span ref={scrollRef} className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap text-xs text-foreground/90 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {transcript || <span className="text-muted-foreground/60">Speak now — release to insert</span>}
      </span>
    </div>
  );
}
