// Opens a page of the app in a headless browser and reports whether a RevealView on it rendered
// a dashboard: the page loads, the Reveal server returns the dashboard, and every widget gets
// data. Saves a full-page screenshot to the OS temp folder and, for each failure, prints the
// usual cause. A server that starts, or an endpoint that answers 200, proves none of this.
//
//     node check-app.mjs http://localhost:5000/ [--wait 45]
//
// Exit 0: the dashboard loaded and every widget has data. 1: something failed (see the list).
// 2: usage error, the page could not be opened, or no browser.
//
// Needs Node 18+ and playwright-core: taken from this folder's node_modules when installed,
// otherwise installed once into the OS temp folder (nothing is written to the project). Uses an
// installed Chrome or Edge, or a Chromium that Playwright already downloaded; never downloads one.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const target = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--wait");
const waitSec = Number(args[args.indexOf("--wait") + 1]) || 45;
if (!target || !/^https?:\/\//.test(target)) {
  console.error("Usage: node check-app.mjs <http(s) URL of the page with the RevealView> [--wait seconds]");
  process.exit(2);
}

// GET  …/DashboardFile/<id>                RVDashboard.loadDashboard(id)
// POST …/dashboard/editor/widget/data      one per visualization; a failing widget still answers 200
const DASHBOARD_RE = /\/DashboardFile\/[^/?#]+/i;
const WIDGET_RE = /\/widget\/data/i;
const NO_DATA = "There's no data to display";

function loadPlaywright() {
  try { return createRequire(import.meta.url)("playwright-core"); } catch { /* not next to the script */ }
  const dir = path.join(os.tmpdir(), "reveal-check-app");
  const req = createRequire(path.join(dir, "index.js"));
  try { return req("playwright-core"); } catch { /* not installed yet */ }
  console.log(`Installing playwright-core into ${dir} (one time)...`);
  fs.mkdirSync(dir, { recursive: true });
  const npm = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", "--prefix", dir, "playwright-core@1"],
    { stdio: "inherit", shell: process.platform === "win32" });
  if (npm.status !== 0) {
    console.error("Could not install playwright-core. Install it next to this script (npm install playwright-core) and rerun.");
    process.exit(2);
  }
  return req("playwright-core");
}

// Chromium builds Playwright downloaded earlier, any revision (a container often has one).
function cachedChromiums() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), ".cache", "ms-playwright"),
    path.join(process.env.LOCALAPPDATA || "", "ms-playwright"),
    path.join(os.homedir(), "Library", "Caches", "ms-playwright")].filter(Boolean);
  const exes = [["chrome-linux64", "chrome"], ["chrome-linux", "chrome"], ["chrome-win64", "chrome.exe"], ["chrome-win", "chrome.exe"],
    ["chrome-mac", "Chromium.app/Contents/MacOS/Chromium"]];
  const found = [];
  for (const root of roots) {
    let dirs = [];
    try { dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse(); } catch { continue; }
    for (const d of dirs) for (const [sub, exe] of exes) {
      const p = path.join(root, d, sub, exe);
      if (fs.existsSync(p)) found.push(p);
    }
  }
  return found;
}

async function launch(chromium) {
  const base = { headless: true, args: process.getuid?.() === 0 ? ["--no-sandbox"] : [] };
  const attempts = [{ channel: "chrome" }, { channel: "msedge" }, {}, ...cachedChromiums().map((executablePath) => ({ executablePath }))];
  for (const a of attempts) {
    try { return await chromium.launch({ ...base, ...a }); } catch { /* try the next one */ }
  }
  console.error("No browser found. Install Chrome or Edge, or run `npx playwright install chromium`, and rerun.");
  process.exit(2);
}

const { chromium } = loadPlaywright();
const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const t = { status: null, dashboards: [], widgets: [], failedLoads: [], pageErrors: [] };
const pending = [];
page.on("pageerror", (e) => t.pageErrors.push(String(e.message).split("\n")[0]));
page.on("requestfailed", (r) => {
  if (["script", "stylesheet", "fetch", "xhr"].includes(r.resourceType())) t.failedLoads.push(`${r.failure()?.errorText ?? "failed"} ${r.url()}`);
});
page.on("response", (r) => {
  const url = r.url(), status = r.status(), type = r.headers()["content-type"] ?? "";
  if (DASHBOARD_RE.test(url)) {
    t.dashboards.push({ url, status, json: type.includes("json") });
  } else if (WIDGET_RE.test(url)) {
    pending.push(r.json().then(
      (body) => { const e = body?.error; t.widgets.push({ status, error: e ? String(e.errorMessage ?? e.message ?? JSON.stringify(e)) : null }); },
      () => { t.widgets.push({ status, error: status >= 400 ? `HTTP ${status}` : null }); }));
  } else if (status >= 400 && ["script", "stylesheet"].includes(r.request().resourceType())) {
    t.failedLoads.push(`HTTP ${status} ${url}`);
  }
});

try {
  const res = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
  t.status = res?.status() ?? null;
} catch (e) {
  console.error(`Could not open ${target}: ${String(e.message).split("\n")[0]}`);
  console.error("Is the app running on that port? Start it in the background and rerun.");
  await browser.close();
  process.exit(2);
}

// The first Reveal request also starts the engine, so allow time; then wait until widget
// requests stop arriving (4 s quiet) and give the view a moment to draw.
const deadline = Date.now() + waitSec * 1000;
while (!t.dashboards.length && Date.now() < deadline) await page.waitForTimeout(500);
if (t.dashboards.length) {
  let seen = -1, quietSince = Date.now();
  const settleBy = Date.now() + 40000;
  while (Date.now() < settleBy && Date.now() - quietSince < 4000) {
    await page.waitForTimeout(500);
    if (pending.length !== seen) { seen = pending.length; quietSince = Date.now(); }
  }
  await Promise.all(pending);
  await page.waitForTimeout(3000);
}
const text = await page.locator("body").innerText().catch(() => "");
const empty = text.split(NO_DATA).length - 1;
const u = new URL(target);
const shot = path.join(os.tmpdir(), `reveal-check-${u.hostname}-${u.port || (u.protocol === "https:" ? 443 : 80)}.png`);
await page.screenshot({ path: shot, fullPage: true });
await browser.close();

// Verdict, with the usual cause for each failure.
const problems = [];
const add = (what, cause) => problems.push({ what, cause });
if (t.status == null || t.status >= 400) {
  add(`The page itself returned HTTP ${t.status}.`,
    "If Reveal is mounted at \"/\", it answers every request and the app's own routes after it return 404: mount it under \"/reveal-api/\" above express.json() and the app's routes, and call RevealSdkSettings.setBaseUrl(location.origin + \"/reveal-api/\").");
}
for (const f of t.failedLoads) {
  add(`A script or stylesheet did not load: ${f}`,
    "With a bundler, import RevealView from the \"reveal-sdk\" npm package; without one, load https://cdn.jsdelivr.net/npm/reveal-sdk@<version>/dist/reveal-sdk.esm.js (or reveal-sdk.js). There is no other script URL.");
}
const okDash = t.dashboards.filter((d) => d.status < 400 && d.json);
if (!t.dashboards.length) {
  add("RevealView never requested a dashboard (no …/DashboardFile/<id> request).",
    "The page did not call RVDashboard.loadDashboard, or the client script failed first: see the script and page errors listed here and the browser console.");
}
for (const d of t.dashboards.filter((d) => !(d.status < 400 && d.json))) {
  const cause = d.status === 401 || d.status === 403
    ? "Reveal rejected an unauthenticated request. Sign in through the app's authentication, or for a local run start the server with --anonymous-demo (never in production)."
    : d.status < 400 && !d.json
      ? "The response is not the dashboard (an HTML page answered): the client's base URL is wrong. Call RevealSdkSettings.setBaseUrl with the Reveal mount prefix, e.g. location.origin + \"/reveal-api/\"."
      : d.status === 400
        ? "With an Express prefix, do not also set the basePath option."
        : "No such dashboard: dashboards/<id>.rdash is read relative to the server's working directory; ids are letters, digits, dash and underscore.";
  add(`Dashboard request answered HTTP ${d.status}: ${d.url}`, cause);
}
if (okDash.length && !t.widgets.length) {
  add("The dashboard loaded, but no widget requested data.", "Check the page errors; a RevealView inside an element with no height draws nothing.");
}
for (const w of t.widgets.filter((w) => w.status >= 400 || w.error)) {
  const cause = /Something went wrong/i.test(w.error ?? "") || w.status >= 500
    ? "If every widget fails this way, a body parser (express.json()) runs before Reveal; otherwise search the engine log for the correlation id."
    : "The server could not get the widget's data: an item the server's providers block (map it to a server-side location), a database it cannot reach, or a wrong field.";
  add(`Widget error: ${w.error ?? `HTTP ${w.status}`}`, cause);
}
if (empty) add(`${empty} widget(s) show "${NO_DATA}".`, "The data source returned no rows: a blocked item, a filter, or fields that do not match the data.");
for (const e of t.pageErrors) add(`Page error: ${e}`, "An uncaught error in the page; it can stop RevealView from rendering.");

console.log(`Page:        ${target}  HTTP ${t.status}`);
console.log(`Dashboard:   ${t.dashboards.length ? t.dashboards.map((d) => `HTTP ${d.status} ${new URL(d.url).pathname}`).join(", ") : "not requested"}`);
console.log(`Widgets:     ${t.widgets.length} data request(s), ${t.widgets.filter((w) => w.status >= 400 || w.error).length} with errors, ${empty} empty`);
console.log(`Screenshot:  ${shot}  (read it)`);
if (problems.length) {
  console.log("\nProblems:");
  for (const p of problems) console.log(`  - ${p.what}\n    Likely cause: ${p.cause}`);
  process.exit(1);
}
console.log("\nThe dashboard rendered and every widget has data.");
