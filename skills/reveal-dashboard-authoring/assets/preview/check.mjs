// Opens a dashboard in headless Chrome or Edge against the running preview server, saves a
// screenshot, and reports what rendered: the visible text, and every Reveal request that
// failed or returned an error. Exit code 1 when any widget request reports an error.
//
//     npm run check -- <dashboard id> [--wait 8]        (preview server must be running)
//     npm run check -- --page client-side.html [id]      the in-browser DOM example
//
// Uses an installed Chrome or Microsoft Edge through playwright-core; no browser download.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const wait = Number(option("--wait")) || 8;
const page_ = option("--page");                       // e.g. --page client-side.html
const id = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const port = Number(process.env.PORT) || 5112;
if (!id && !page_) {
  console.error("Usage: npm run check -- <dashboard id> [--wait seconds] [--page other.html]");
  process.exit(2);
}
const target = `http://localhost:${port}/${page_ ?? ""}${id ? `?dashboard=${encodeURIComponent(id)}` : ""}`;
const shotName = [page_?.replace(/\.html$/, ""), id].filter(Boolean).join("-");

let browser;
for (const channel of ["chrome", "msedge", undefined]) {
  try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* try the next one */ }
}
if (!browser) {
  console.error("No Chrome or Edge found. Install one, or run `npx playwright install chromium`.");
  process.exit(2);
}

const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const problems = [];
page.on("console", m => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
page.on("response", async r => {
  const url = r.url();
  if (!url.startsWith(`http://localhost:${port}/`) || url.includes("/sample-data/") || url.endsWith("favicon.ico")) return;
  if (r.status() >= 400) { problems.push(`HTTP ${r.status()} ${url}`); return; }
  // Widget failures arrive as HTTP 200 with an error object in the body.
  // Shape on Reveal 2.2: {"error":{"key":"GetDataForWidget","errorMessage":"...","additionalInfo":{"ds-id":"..."}}}
  if ((r.headers()["content-type"] ?? "").includes("json")) {
    let error;
    try { error = JSON.parse(await r.text())?.error; } catch { return; }
    if (error) {
      const where = error.additionalInfo ? ` ${JSON.stringify(error.additionalInfo)}` : "";
      problems.push(`widget error: ${error.errorMessage ?? error.message ?? JSON.stringify(error)}${where}  (${url.replace(`http://localhost:${port}`, "")})`);
    }
  }
});

await page.goto(target);
await page.waitForFunction(() => document.body.dataset.loaded, null, { timeout: 30000 }).catch(() => {});
const state = await page.evaluate(() => document.body.dataset.loaded);
if (state !== "true") problems.push(state === "error" ? "page: the dashboard failed to load (see the visible text)" : "page: did not finish loading in 30 s");
await page.waitForTimeout(wait * 1000);

mkdirSync("screenshots", { recursive: true });
const shot = `screenshots/${shotName}.png`;
await page.screenshot({ path: shot, fullPage: true });
const text = (await page.innerText("body")).replace(/\n{2,}/g, "\n").trim();
await browser.close();

console.log(`Screenshot: ${shot}\n\nVisible text:\n${text.split("\n").map(l => `  ${l}`).join("\n")}\n`);
const ignorable = p => /favicon|Failed to load resource: the server responded with a status of 404/.test(p);
const real = [...new Set(problems)].filter(p => !ignorable(p));
if (real.length) {
  console.log(`Problems:\n${real.map(p => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("No request errors.");
