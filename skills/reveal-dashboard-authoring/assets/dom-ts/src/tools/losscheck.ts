// What would a DOM round trip lose? Reports properties that are present (with a non-default
// value) in the original Dashboard.json and missing from the DOM's output, and lists changed values.
//
//   npm run losscheck -- Sales.rdash                  load + save with @revealbi/dom, compare
//   npm run losscheck -- before.rdash after.rdash     compare any two files (e.g. .NET output)
//
// With two files, visualizations and filters are matched by id, so ones you removed on purpose aren't reported.
// Exit code 0: nothing user-visible lost (changed values are listed for review). 1: settings lost.
// 2: the DOM can't load the file.
import { readFile } from "node:fs/promises";
import { RdashDocument } from "@revealbi/dom";
import { readRdashJson } from "../lib/rdash-file.js";

type J = any;
const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath) {
  console.error("Usage: npm run losscheck -- <file.rdash> [<after.rdash>]");
  process.exit(2);
}

const before = await readRdashJson(beforePath);
let after: J;
if (afterPath) {
  after = await readRdashJson(afterPath);
} else {
  try {
    after = (await RdashDocument.loadFromBuffer(await readFile(beforePath))).toJson();
  } catch (e) {
    console.log(`The DOM can't load ${beforePath}: ${(e as Error).message.split("\n")[0]}`);
    process.exit(2);
  }
}

// Values Reveal applies anyway when a property is missing, so dropping them changes nothing.
// An object counts as default when every value in it does (e.g. date-time settings left at 0 / false).
// Falsy is not always the default: for these properties 0 / false is a real setting, so losing it is a loss.
const FALSY_IS_MEANINGFUL = new Set(["UseAutoLayout", "DecimalDigits"]);
const isDefault = (v: unknown, key = ""): boolean =>
  !(FALSY_IS_MEANINGFUL.has(key) && (v === false || v === 0)) && (
  v === null || v === false || v === 0 || v === "" || v === "None" || v === "Auto" || v === "Inherit" ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && v !== null && !Array.isArray(v) && Object.entries(v).every(([k, x]) => k === "_type" || isDefault(x, k))));
const IGNORE = new Set(["_type", "SavedWith", "FormatVersion"]);

const losses: string[] = [];   // present before, gone after
const changes: string[] = [];  // value differs: may be your own edit, so listed for review only
function walk(a: J, b: J, path: string, key = "") {
  if (a === null || typeof a !== "object") {
    if (b === undefined) { if (!isDefault(a, key)) losses.push(`${path}: ${JSON.stringify(a)} -> (dropped)`); }
    else if (b !== a) changes.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) { if (!isDefault(a)) losses.push(`${path}: list is gone`); return; }
    // Match objects with an Id (widgets, filters) by id; others by position. With two files, an id that
    // vanished was removed on purpose. In a one-file round trip nobody removed anything, so it is a loss.
    const byId = a.every((x: J) => x && typeof x === "object" && "Id" in x);
    a.forEach((x: J, i: number) => {
      const y = byId ? b.find((z: J) => z?.Id === x.Id) : b[i];
      if (byId && !y) { if (!afterPath) losses.push(`${path}[${JSON.stringify(x.Title ?? x.Id)}]: object is gone`); return; }
      walk(x, y, `${path}[${byId ? JSON.stringify(x.Title ?? x.Id) : i}]`);
    });
    return;
  }
  if (b === null || typeof b !== "object") { if (!isDefault(a, key)) losses.push(`${path}: object is gone`); return; }
  for (const [k, v] of Object.entries(a)) {
    if (IGNORE.has(k)) continue;
    if (!(k in b)) { if (!isDefault(v, k)) losses.push(`${path}.${k}: ${JSON.stringify(v).slice(0, 80)} -> (dropped)`); continue; }
    walk(v, b[k], `${path}.${k}`, k);
  }
}
walk(before, after, "");

if (changes.length) {
  console.log(`${changes.length} value(s) changed (expected if you edited them):`);
  for (const c of changes.slice(0, 20)) console.log(`  ${c}`);
  if (changes.length > 20) console.log(`  ... ${changes.length - 20} more`);
  console.log();
}
// Settings known to change what users see. Other dropped properties are often legacy ones that
// older editors wrote and Reveal no longer reads (SummarizationSpec, LabelField, ...): listed, not failed.
const VISIBLE = new Set(["Widgets", "Filters", "UseAutoLayout", "IsHidden", "Formatting", "DateFormat", "FormatType", "DecimalDigits", "CurrencySymbol", "Sorting", "GroupedColumns", "SortedColumns", "Hyperlink", "Pinning", "Settings", "DefaultRefreshRate", "Title", "Description", "Filter", "Bindings", "SelectedItems", "RuleType", "ColumnSpan", "RowSpan"]);
// SummarizationSpec is a legacy block. VisualizationDataSpec.Columns[].Sorting is never read by Reveal:
// a grid's sort order lives on DataSpec.Fields[].Sorting.
const LEGACY = /\.SummarizationSpec\b|VisualizationDataSpec\.Columns\[[^\]]*\]\.Sorting/;
// Judge by the dropped property itself (Formatting.ShowDataLabels is renamed, not lost).
const droppedKey = (l: string) => l.split(":")[0].split(".").pop()!.replace(/\[.*$/, "");
const visible = losses.filter((l) => VISIBLE.has(droppedKey(l)) && !LEGACY.test(l));
const other = losses.filter((l) => !visible.includes(l));

// Group by property so 40 identical date formats read as one line.
function printGroups(list: string[]) {
  const groups = new Map<string, string[]>();
  for (const l of list) {
    const key = l.replace(/\[[^\]]*\]/g, "[]").split(":")[0];
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  for (const [key, items] of groups) console.log(`  ${items.length} x ${key}\n      e.g. ${items[0]}`);
}
if (other.length) {
  console.log(`${other.length} other ${other.length === 1 ? "property" : "properties"} dropped. Often legacy settings Reveal no longer reads; if one looks visible, render the original and the result and compare:`);
  printGroups(other);
  console.log();
}
if (!visible.length) {
  console.log("No user-visible settings lost.");
  process.exit(0);
}
console.log(`${visible.length} user-visible setting(s) lost:`);
printGroups(visible);
console.log("\nFollow \"Use only the DOM\" in SKILL.md: tell the user, offer an issue draft, and ask before going on.");
process.exit(1);
