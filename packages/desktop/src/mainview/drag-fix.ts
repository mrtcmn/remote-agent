// Electrobun's titlebar drag can leave a move open: its preload sends stopWindowMove
// only when the mouse comes up over a drag region, and native startWindowMove never
// removes the previous drag's event monitors. A leaked monitor keeps its OLD mousedown
// point, so the next drag jumps the window by the distance between the two clicks
// (move 30px → window flies 600px). Monitor reconnects make it common: the window
// shifts under the cursor and the mouseup lands outside the drag region.
//
// Fix from our side (the native code is in the Electrobun dylib): close any open move
// right before the preload starts a new one, and on every mouseup / blur.
// ponytail: workaround — drop this file once Electrobun pairs start/stop itself.

declare global {
  interface Window {
    __electrobunInternalBridge?: { postMessage(message: string): void };
  }
}

function stopWindowMove() {
  const id = window.__electrobunWindowId;
  if (id === undefined) return;
  window.__electrobunInternalBridge?.postMessage(
    JSON.stringify([JSON.stringify({ type: 'message', id: 'stopWindowMove', payload: { id } })]),
  );
}

function isDragTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !target.closest('.electrobun-webkit-app-region-no-drag')
    && !!target.closest('.electrobun-webkit-app-region-drag');
}

export function installDragFix() {
  // Capture phase on window runs before the preload's document listener, so this
  // stop reaches native before its start.
  window.addEventListener('mousedown', (e) => { if (isDragTarget(e.target)) stopWindowMove(); }, true);
  window.addEventListener('mouseup', stopWindowMove, true);
  window.addEventListener('blur', stopWindowMove);
}
