import { useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * One-line text that ellipsizes at rest; on hover it smooth-scrolls (marquee)
 * to the end, stays there while hovered, and smooth-resets on leave.
 * Constrain with a max-w-* class.
 */
export function MarqueeText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span
      ref={ref}
      onMouseEnter={() => ref.current?.scrollTo({ left: ref.current.scrollWidth, behavior: 'smooth' })}
      onMouseLeave={() => ref.current?.scrollTo({ left: 0, behavior: 'smooth' })}
      className={cn(
        'block overflow-hidden whitespace-nowrap text-ellipsis hover:[text-overflow:clip]',
        className,
      )}
    >
      {text}
    </span>
  );
}
