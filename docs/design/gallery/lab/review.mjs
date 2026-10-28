import { chromium } from "/home/kristjan/code/agent-jobs/node_modules/playwright-core/index.mjs";
const shots = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/home/kristjan/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell" });
for (const spec of shots) {
  const [name, path, w, h, sel] = spec.split("|");
  const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
  await page.goto(`file:///tmp/design-proto/${path}`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(700);
  if (sel) { const el = await page.$(sel); await el.screenshot({ path: `/tmp/design-lab/rv-${name}.png` }); }
  else await page.screenshot({ path: `/tmp/design-lab/rv-${name}.png` });
  await page.close();
}
await browser.close(); console.log("ok");
