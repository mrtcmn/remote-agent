import { Tray, Utils } from "electrobun/bun";

/** Mirrors packages/electron/src/main.ts createTray (Show Window / Quit). */
export function createTray(onShow: () => void): Tray {
  const tray = new Tray({
    title: "",
    image: "views://assets/trayTemplate.png",
    template: true,
    width: 16,
    height: 16,
  });

  tray.setMenu([
    { type: "normal", label: "Show Window", action: "show-window" },
    { type: "divider" },
    { type: "normal", label: "Quit", action: "quit" },
  ]);

  tray.on("tray-clicked", (e: any) => {
    const action = e.data?.action;
    // Bare icon click delivers action === "" (not on Linux — use the menu item there).
    if (action === "" || action === "show-window") {
      onShow();
      return;
    }
    if (action === "quit") {
      tray.remove();
      Utils.quit();
    }
  });

  return tray;
}
