// Bulk migration: applies migrate() below to every .rdash in a folder and writes the results to
// another folder. The originals are never written. A result is kept only when the binding guard
// passes and losscheck (original vs result) finds no user-visible loss; otherwise it is refused and
// the reason logged. Editor dashboards often fail on hidden fields (IsHidden) alone: read the
// per-property tally at the end, decide with the user, and rerun with --allow-loss only for that.
//
//   npm run migrate -- <in-folder> [--out <out-folder>] [--allow-loss]
//
// Default out folder: <in-folder>-migrated. The log is <out-folder>/migrate-log.txt.
// Exit code 0: every dashboard written. 1: some refused or failed (see the log).
import { spawnSync } from "node:child_process";
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RdashDocument } from "@revealbi/dom";
import { findBindingProblems } from "../lib/guard.js";
import { readRdashJson } from "../lib/rdash-file.js";

/** Your change, applied to each loaded dashboard. Example: point every SQL Server source at a new host. */
export function migrate(doc: RdashDocument): void {
  for (const ds of doc.dataSources) {
    if (ds.provider === "SQLSERVER" && ds.properties.Host === "old-sql.example.com") ds.properties.Host = "new-sql.example.com";
  }
}

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const allowLoss = args.includes("--allow-loss");
if (allowLoss) args.splice(args.indexOf("--allow-loss"), 1);
const outArg = flag("--out");
const inDir = args[0];
if (!inDir) {
  console.error("Usage: npm run migrate -- <in-folder> [--out <out-folder>] [--allow-loss]");
  process.exit(2);
}
const outDir = resolve(outArg ?? `${inDir.replace(/[\\/]+$/, "")}-migrated`);
if (outDir === resolve(inDir)) {
  console.error("The out folder must differ from the input folder: originals are never overwritten.");
  process.exit(2);
}
await mkdir(outDir, { recursive: true });
const logPath = join(outDir, "migrate-log.txt");
await writeFile(logPath, `migrate ${resolve(inDir)} -> ${outDir}${allowLoss ? " (--allow-loss)" : ""}\n`);
const log = (s: string) => appendFile(logPath, s + "\n");
const losscheck = fileURLToPath(new URL("./losscheck.ts", import.meta.url));

const files = (await readdir(inDir)).filter(f => f.toLowerCase().endsWith(".rdash"));
const counts = { written: 0, refused: 0, failed: 0 };
const tally = new Map<string, number>(); // visible losses by property, across files, for triage
for (const file of files) {
  const src = join(inDir, file);
  const dest = join(outDir, file);
  const pending = `${dest}.pending`;
  const done = async (status: keyof typeof counts, why: string, detail = "") => {
    counts[status]++;
    console.log(`${status.padEnd(8)} ${file}${why ? `  ${why}` : ""}`);
    await log(`\n== ${status}: ${file}${why ? `  ${why}` : ""}${detail ? `\n${detail.trimEnd()}` : ""}`);
  };
  try {
    const original = await readRdashJson(src);
    const doc = await RdashDocument.loadFromBuffer(await readFile(src));
    migrate(doc);
    // Serialize once (each toBlob adds data source copies to a new document) and judge the bytes written.
    await writeFile(pending, Buffer.from(await doc.toBlob().arrayBuffer()));
    // Problems the original already had (e.g. dead filter bindings in editor files) don't count.
    const before = new Set(findBindingProblems(original));
    const problems = findBindingProblems(await readRdashJson(pending)).filter(p => !before.has(p));
    if (problems.length) { await rm(pending); await done("refused", "guard", problems.join("\n")); continue; }
    const r = spawnSync(process.execPath, ["--import", "tsx", losscheck, src, pending], { encoding: "utf8" });
    if (r.status === 1) {
      const section = r.stdout.split(/user-visible setting\(s\) lost:/)[1] ?? "";
      for (const m of section.matchAll(/^\s+(\d+) x (\S+)/gm)) tally.set(m[2], (tally.get(m[2]) ?? 0) + Number(m[1]));
      if (!allowLoss) { await rm(pending); await done("refused", "visible settings lost", r.stdout); continue; }
    } else if (r.status !== 0) {
      await rm(pending); await done("failed", "losscheck could not compare", r.stdout + r.stderr); continue;
    }
    await rename(pending, dest);
    await done("written", r.status === 1 ? "with losses (--allow-loss)" : "", r.stdout);
  } catch (e) {
    await rm(pending, { force: true });
    await done("failed", (e as Error).message.split("\n")[0]);
  }
}

console.log(`\n${counts.written} written, ${counts.refused} refused, ${counts.failed} failed of ${files.length}. Log: ${logPath}`);
if (tally.size) {
  console.log("Visible losses by property (decide per property with the user before --allow-loss):");
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${n} x ${k}`);
}
console.log(`Originals in ${basename(resolve(inDir))} were not changed. Render a sample of the results before replacing anything.`);
process.exit(counts.refused || counts.failed ? 1 : 0);
