// Electrobun copies only the binary into each CEF helper .app, with no
// Info.plist, so macOS shows every renderer/GPU process as a "bun Helper" app
// in the Dock. LSUIElement hides them, the way Chrome's own helpers do.
import { readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const buildDir = process.env.ELECTROBUN_BUILD_DIR!;
const app = readdirSync(buildDir).find((name) => name.endsWith(".app"));
const frameworks = app && join(buildDir, app, "Contents", "Frameworks");

if (frameworks && existsSync(frameworks)) {
  for (const helper of readdirSync(frameworks).filter((name) => name.includes("Helper") && name.endsWith(".app"))) {
    const name = helper.slice(0, -".app".length);
    writeFileSync(
      join(frameworks, helper, "Contents", "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>${name}</string>
  <key>CFBundleIdentifier</key><string>${process.env.ELECTROBUN_APP_IDENTIFIER}.helper</string>
  <key>CFBundleName</key><string>${name}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`,
    );
  }
}
