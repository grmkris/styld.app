import { chromium } from "/home/kristjan/code/agent-jobs/node_modules/playwright-core/index.mjs";
const dirs = ["gallery","mono","soft","pin","night","lookbook","deck","rail","colour","index"];
const browser = await chromium.launch({ executablePath: "/home/kristjan/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell" });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
for (const d of dirs) {
  await page.goto(`file:///tmp/design-proto/${d}/home.html`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
  const f = await page.$(".frame.phone .screen");
  const b = await f.boundingBox();
  await page.screenshot({ path: `/tmp/design-proto/thumbs/${d}.jpg`, type: "jpeg", quality: 82, clip: { x: b.x, y: b.y, width: 390 - 20, height: 560 } });
}
await browser.close(); console.log("thumbs ok");
