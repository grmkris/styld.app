import { chromium } from "/home/kristjan/code/agent-jobs/node_modules/playwright-core/index.mjs";
const browser = await chromium.launch({ executablePath: "/home/kristjan/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell" });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await page.goto("file:///tmp/design-lab/index.html", { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
await page.waitForTimeout(2500);
for (const id of ["lookbook", "deck", "rail", "colour", "index"]) {
  await (await page.$(`#${id} .frames`)).screenshot({ path: `/tmp/design-lab/r2-${id}-phones.png` });
  await (await page.$(`#${id} .desk`)).screenshot({ path: `/tmp/design-lab/r2-${id}-desk.png` });
}
await browser.close();
console.log("ok");
