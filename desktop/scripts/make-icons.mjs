/**
 * Renders the app icon (assets/icon.svg, full-bleed artwork) into the PNGs that electron-builder
 * turns into the macOS .icns and the Windows .ico. Run it after changing the SVG:
 * npm run build:icons (the PNGs are committed, so builds need no browser).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");
const svg = `data:image/svg+xml;base64,${fs.readFileSync(path.join(assets, "icon.svg")).toString("base64")}`;

// macOS (Apple's icon grid): the shape fills 824 of 1024 px, with a soft shadow below it.
// Windows: the shape fills most of the square and has no shadow.
const variants = [
  { file: "icon-mac.png", size: 824, filter: "drop-shadow(0 10px 12px rgb(0 0 0 / 0.3))" },
  { file: "icon-win.png", size: 960, filter: "none" },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  for (const v of variants) {
    await page.setContent(
      `<body style="margin:0;width:1024px;height:1024px;display:grid;place-items:center">` +
        `<img src="${svg}" width="${v.size}" height="${v.size}" style="filter:${v.filter}"></body>`,
    );
    await page.locator("img").evaluate((img) => img.decode());
    await page.screenshot({ path: path.join(assets, v.file), omitBackground: true });
    console.log(`assets/${v.file}`);
  }
} finally {
  await browser.close();
}
