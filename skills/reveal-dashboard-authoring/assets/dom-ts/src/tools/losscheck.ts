// What would a DOM round trip lose? Reports properties that are present (with a non-default
// value) in the original Dashboard.json and missing (or null) in the DOM's output, properties the
// round trip adds (a number format where there was none changes what users see), and changed values.
//
//   npm run losscheck -- Sales.rdash                  load + save with @revealbi/dom, compare
//   npm run losscheck -- before.rdash after.rdash     compare any two files (e.g. .NET output)
//
// With two files, visualizations and filters are matched by id: ones you removed or added on purpose are
// listed, not failed. One recreated with a new id shows as removed + added, and what it lost is not
// compared, so read that list too. Additions fail only a one-file round trip, where nobody edited anything.
// Exit code 0: nothing the tool knows to be visible was lost or added. That isn't proof the dashboard looks
// the same: render both and compare. 1: settings lost (or added). 2: a file can't be read, or the DOM can't load it.
import { readFile } from "node:fs/promises";
import { RdashDocument } from "@revealbi/dom";
import { readRdashJson } from "../lib/rdash-file.js";

type J = any;
const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath) {
  console.error("Usage: npm run losscheck -- <file.rdash> [<after.rdash>]");
  process.exit(2);
}

// Any failure to read is exit 2: exit 1 would claim settings were lost from a file never compared.
const fail = (what: string, e: unknown): never => {
  console.log(`${what}: ${(e as Error).message.split("\n")[0]}`);
  process.exit(2);
};
const before: J = await readRdashJson(beforePath).catch(e => fail(`Can't read ${beforePath}`, e));
let after: J;
if (afterPath) {
  after = await readRdashJson(afterPath).catch(e => fail(`Can't read ${afterPath}`, e));
} else {
  try {
    after = (await RdashDocument.loadFromBuffer(await readFile(beforePath))).toJson();
  } catch (e) {
    fail(`The DOM can't load ${beforePath}`, e);
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

const losses: string[] = [];       // present before, gone (or null) after
const additions: string[] = [];    // absent before, set after
const changes: string[] = [];      // value differs: may be your own edit, so listed for review only
const removedAdded: string[] = []; // two files: objects matched by id that only one side has
const label = (x: J) => JSON.stringify(x.Title ?? x.Id);
function walk(a: J, b: J, path: string, key = "") {
  if (a === null || typeof a !== "object") {
    if (b === undefined || (b === null && a !== null)) { if (!isDefault(a, key)) losses.push(`${path}: ${JSON.stringify(a)} -> ${b === null ? "null" : "(dropped)"}`); }
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
      if (byId && !y) {
        if (afterPath) removedAdded.push(`removed: ${path}[${label(x)}]  id=${x.Id}`);
        else losses.push(`${path}[${label(x)}]: object is gone`);
        return;
      }
      walk(x, y, `${path}[${byId ? label(x) : i}]`);
    });
    if (byId && afterPath) {
      for (const y of b) if (y && typeof y === "object" && !a.some((x: J) => x.Id === y.Id)) removedAdded.push(`added: ${path}[${label(y)}]  id=${y.Id}`);
    }
    return;
  }
  if (b === null || typeof b !== "object") { if (!isDefault(a, key)) losses.push(`${path}: object is gone`); return; }
  for (const [k, v] of Object.entries(a)) {
    if (IGNORE.has(k)) continue;
    if (!(k in b)) { if (!isDefault(v, k)) losses.push(`${path}.${k}: ${JSON.stringify(v).slice(0, 80)} -> (dropped)`); continue; }
    walk(v, b[k], `${path}.${k}`, k);
  }
  for (const [k, v] of Object.entries(b)) {
    if (!IGNORE.has(k) && !(k in a) && !isDefault(v, k)) additions.push(`${path}.${k}: (added) ${JSON.stringify(v).slice(0, 80)}`);
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
// From 348 editor dashboards, rendered: a date filter that lost its CustomRule makes the dashboard fail to
// open; ApplyMkFormat is the K/M number format; a scatter map whose ZoomRectangle lost X/Y/Width/Height is blank.
const VISIBLE = new Set(["Widgets", "Filters", "UseAutoLayout", "IsHidden", "Formatting", "DateFormat", "FormatType", "DecimalDigits", "CurrencySymbol", "Sorting", "GroupedColumns", "SortedColumns", "Hyperlink", "Pinning", "Settings", "DefaultRefreshRate", "Title", "Description", "Filter", "Bindings", "SelectedItems", "RuleType", "CustomRule", "CustomDateRange", "ColumnSpan", "RowSpan",
  "ApplyMkFormat", "ConditionalFormatting", "Definitions", "LegendLocation", "ZoomRectangle", "IsReadOnly", "DataSourceItem", "Annotations", "Regions", "GridLinesMode"]);
// SummarizationSpec is a legacy block. VisualizationDataSpec.Columns[].Sorting is never read by Reveal:
// a grid's sort order lives on DataSpec.Fields[].Sorting. A data source item's Description isn't shown
// in a view; the dashboard's and a visualization's are.
const LEGACY = /\.SummarizationSpec\b|VisualizationDataSpec\.Columns\[[^\]]*\]\.Sorting|DataSourceItem(\.ResourceItem)?\.Description:|XmlaMeasure\.Description:/;
// Judge by the property itself. Formatting.ShowDataLabels isn't in VISIBLE, so its loss is listed under "other".
const propertyOf = (l: string) => l.split(":")[0].split(".").pop()!.replace(/\[.*$/, "");
const isVisible = (l: string) => (VISIBLE.has(propertyOf(l)) || /\.ZoomRectangle\.(X|Y|Width|Height):/.test(l)) && !LEGACY.test(l);
const visible = losses.filter(isVisible);
const other = losses.filter((l) => !visible.includes(l));
const visibleAdded = additions.filter(isVisible);

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
if (removedAdded.length) {
  console.log("Only in one file (matched by id; one recreated with a new id is listed twice, and what it lost isn't compared):");
  for (const l of removedAdded) console.log(`  ${l}`);
  console.log();
}
if (visibleAdded.length) {
  console.log(`${visibleAdded.length} user-visible setting(s) added${afterPath ? " (expected if you set them)" : " by the round trip"}:`);
  printGroups(visibleAdded);
  console.log();
}
// Additions fail only a one-file round trip: with two files they may be your own edits.
const addedFails = !afterPath && visibleAdded.length > 0;
if (!visible.length && !addedFails) {
  console.log("No user-visible settings lost.");
  process.exit(0);
}
if (visible.length) {
  console.log(`${visible.length} user-visible setting(s) lost:`);
  printGroups(visible);
}
console.log("\nFollow \"Use only the DOM\" in SKILL.md: tell the user, offer an issue draft, and ask before going on.");
process.exit(1);
