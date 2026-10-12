// Runs the binding guard (src/lib/guard.ts) on .rdash files: generated, edited, or made in the
// editor or by Reveal.Sdk.Dom. Reads the raw JSON, so it works on files the DOM can't load.
//   npm run guard -- Sales.rdash [More.rdash ...]
// Exit code 0: every file passes. 1: a binding can't work (listed). 2: a file can't be read.
import { findBindingProblems } from "../lib/guard.js";
import { readRdashJson } from "../lib/rdash-file.js";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: npm run guard -- <file.rdash> [<file.rdash> ...]");
  process.exit(2);
}
let exit = 0;
for (const file of files) {
  let problems: string[];
  try { problems = findBindingProblems(await readRdashJson(file)); }
  catch (e) { console.log(`${file}: can't read it: ${(e as Error).message.split("\n")[0]}`); exit = 2; continue; }
  if (!problems.length) { console.log(`${file}: ok`); continue; }
  console.log(`${file}: ${problems.length} problem(s)`);
  for (const p of problems) console.log(`  ${p}`);
  if (exit === 0) exit = 1;
}
process.exit(exit);
