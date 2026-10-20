// Opens a page of the app in a headless browser and reports whether a RevealView on it rendered
// a dashboard: the page loads, the Reveal server returns the dashboard, and every widget gets
// data. Saves a full-page screenshot to the OS temp folder and, for each failure, prints the
// usual cause. A server that starts, or an endpoint that answers 200, proves none of this.
//
//     node check-app.mjs http://localhost:5000/ --start "npm run dev" [--wait 45]
//
// --start runs the app the way its users do: the project's own command, from the current
// folder, with nothing added. check-app waits for the URL, checks the page, stops the app
// again and prints its output when something failed. So a setting that lives only in your
// terminal (an extra argument, an environment variable) can't make the check pass. Without
// --start, the app must already be running on the URL.
//
// Exit 0: the dashboard loaded and every widget has data. 1: something failed (see the list).
// 2: usage error, the page could not be opened, the URL was already taken, or no browser.
//
// Needs Node 18+ and playwright-core: taken from this folder's node_modules when installed,
// otherwise installed once into the OS temp folder (nothing is written to the project). Uses an
// installed Chrome or Edge, or a Chromium that Playwright already downloaded; never downloads one.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const valueOf = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const target = args.find((a, i) => !a.startsWith("--") && !["--wait", "--start"].includes(args[i - 1]));
const waitSec = Number(valueOf("--wait")) || 45;
const startCmd = valueOf("--start");
if (!target || !/^https?:\/\//.test(target) || (args.includes("--start") && !startCmd?.trim()) || startCmd?.startsWith("--")) {
  console.error('Usage: node check-app.mjs <http(s) URL of the page with the RevealView> [--start "<command that starts the app>"] [--wait seconds]');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ── The app, with --start ──────────────────────────────────────────────────────
let app = null;
const appLog = [];
const keepLog = (chunk) => {
  appLog.push(...String(chunk).split(/\r?\n/).filter((l) => l.trim()));
  if (appLog.length > 300) appLog.splice(0, appLog.length - 300);
};
const logTail = (n) => appLog.slice(-n).map((l) => `    | ${l}`).join("\n") || "    (no output)";

// Any HTTP answer counts, even a 404 or a certificate error; a refused connection does not.
// "localhost" is tried as 127.0.0.1 too: a server on 0.0.0.0 doesn't answer on ::1.
async function answers(url) {
  const u = new URL(url);
  const urls = u.hostname === "localhost" ? [u.href, u.href.replace("//localhost", "//127.0.0.1")] : [u.href];
  for (const x of urls) {
    try { await fetch(x, { redirect: "manual", signal: AbortSignal.timeout(3000) }); return true; } catch (e) {
      if (!/ECONNREFUSED|ECONNRESET|EADDRNOTAVAIL|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT|Timeout|Abort/.test(`${e.cause?.code} ${e.name}`)) return true;
    }
  }
  return false;
}

// Stops the app and everything it started (npm, the shell, node): taskkill /T on Windows, the
// process group elsewhere.
function stopApp(signal = "SIGTERM") {
  if (!app) return;
  app.stopping = true;
  if (process.platform === "win32") {
    if (!app.ended) spawnSync("taskkill", ["/pid", String(app.pid), "/T", "/F"], { stdio: "ignore" });
  } else try { process.kill(-app.pid, signal); } catch { /* already gone */ }
}
async function stopAppAndWait() {
  stopApp();
  for (let i = 0; app && !app.ended && i < 40; i++) await sleep(200);
  stopApp("SIGKILL");
}
process.on("exit", () => stopApp("SIGKILL"));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { stopApp(); process.exit(130); });

const { chromium } = loadPlaywright();
const browser = await launch(chromium);   // before the app, so a missing browser leaves nothing running

if (startCmd) {
  if (await answers(target)) {
    console.error(`Something already answers on ${new URL(target).origin}. Stop the server you started there (that process only, never all node processes), then rerun: with --start, check-app runs the app itself, the way a user does.`);
    await browser.close();
    process.exit(2);
  }
  console.log(`Starting the app: ${startCmd}  (in ${process.cwd()})`);
  app = spawn(startCmd, { shell: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  app.stdout.on("data", keepLog);
  app.stderr.on("data", keepLog);
  app.on("exit", (code, signal) => { app.ended = { code: code ?? signal }; });
  const readyBy = Date.now() + 90000;
  while (!app.ended && Date.now() < readyBy && !(await answers(target))) await sleep(500);
  if (app.ended || Date.now() >= readyBy) {
    console.error(`"${startCmd}" ${app.ended ? `exited (${app.ended.code}) before ${target} answered` : `did not answer on ${target} within 90 s`}. Its output:\n${logTail(60)}`);
    console.error("Fix the start itself first (a missing package, a crash, a port in use, another URL or port).");
    await stopAppAndWait();
    await browser.close();
    process.exit(1);
  }
}

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
  if (startCmd) console.error(`The app's output:\n${logTail(40)}`);
  else console.error('Is the app running on that port? Rerun with --start "<the command that starts it>" so check-app starts it.');
  await browser.close();
  await stopAppAndWait();
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
const crashed = app?.ended && !app.stopping ? app.ended.code : null;
await stopAppAndWait();

// Verdict, with the usual cause for each failure.
const problems = [];
const add = (what, cause) => problems.push({ what, cause });
if (crashed != null) {
  add(`The app exited during the check (${crashed}).`, "See its output below: a crash on the first Reveal request is often the license (no key) or a dashboard provider returning a Buffer instead of a stream.");
}
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
    ? "Reveal requires a signed-in user and this request had none. If the app has no login, allow anonymous viewing in the server code (with node-minimal's module: mountReveal(app, { port, allowAnonymous: true })); an argument or variable in your own terminal fixes only your run. If the app has login, this check cannot sign in: verify the dashboard signed in, and say so."
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
  const cause = /unknown type \('REST'\)/i.test(w.error ?? "")
    ? "The dashboard's REST item lost its JSON wrapper: it was built with new RestDataSourceItem() and no arguments, or item.dataSource was assigned afterwards. Rebuild it with jsonFileItem (reveal-dashboard-authoring, sample-data.ts) or new RestDataSourceItem(title, url, dataSource)."
    : /Something went wrong/i.test(w.error ?? "") || w.status >= 500
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
if (app) console.log(`App:         started with "${startCmd}" and stopped again`);
if (problems.length) {
  console.log("\nProblems:");
  for (const p of problems) console.log(`  - ${p.what}\n    Likely cause: ${p.cause}`);
  if (app) console.log(`\nThe app's output (last lines):\n${logTail(40)}`);
  process.exit(1);
}
console.log("\nThe dashboard rendered and every widget has data.");
