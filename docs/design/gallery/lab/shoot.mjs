import { chromium } from "/home/kristjan/code/agent-jobs/node_modules/playwright-core/index.mjs";
const browser = await chromium.launch({ executablePath: "/home/kristjan/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell" });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await page.goto("file:///tmp/design-lab/index.html", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2000);
for (const id of ["gallery", "mono", "soft", "pin", "night"]) {
  const el = await page.$(`#${id} .frames`);
  await el.screenshot({ path: `/tmp/design-lab/${id}-phones.png` });
}
await browser.close();
console.log("ok");
