import { useCallback, useRef } from 'react';

interface ResizeHandleProps {
  onResize: (newWidth: number) => void;
  currentWidth: number;
}

export function ResizeHandle({ onResize, currentWidth }: ResizeHandleProps) {
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = currentWidth;

      const handleMouseMove = (e: MouseEvent) => {
        const delta = e.clientX - startXRef.current;
        onResize(startWidthRef.current + delta);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [onResize, currentWidth]
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className="w-1 cursor-col-resize bg-border/40 hover:bg-primary/30 active:bg-primary/50 transition-colors shrink-0"
    />
  );
}
