import { Tray, Utils } from "electrobun/bun";

/** Mirrors packages/electron/src/main.ts createTray (Show Window / Quit). */
export function createTray(
  onShow: () => void,
  onReload: () => void,
  onDevTools: () => void,
  glass: { get: () => boolean; toggle: () => void },
): Tray {
  const tray = new Tray({
    title: "",
    image: "views://assets/trayTemplate.png",
    template: true,
    width: 16,
    height: 16,
  });

  const setMenu = () =>
    tray.setMenu([
      { type: "normal", label: "Show Window", action: "show-window" },
      { type: "divider" },
      { type: "normal", label: "Glass Window", action: "glass", checked: glass.get() },
      { type: "normal", label: "Reload", action: "reload" },
      { type: "normal", label: "Open Dev Tools", action: "dev-tools" },
      { type: "divider" },
      { type: "normal", label: "Quit", action: "quit" },
    ]);
  setMenu();

  tray.on("tray-clicked", (e: any) => {
    const action = e.data?.action;
    console.log("[tray] clicked:", JSON.stringify(e.data));
    // Bare icon click delivers action === "" (not on Linux — use the menu item there).
    if (action === "" || action === "show-window") {
      onShow();
      return;
    }
    if (action === "glass") {
      glass.toggle();
      setMenu(); // refresh the check mark
      return;
    }
    if (action === "reload") {
      onReload();
      return;
    }
    if (action === "dev-tools") {
      onDevTools();
      return;
    }
    if (action === "quit") {
      tray.remove();
      Utils.quit();
    }
  });

  return tray;
}
