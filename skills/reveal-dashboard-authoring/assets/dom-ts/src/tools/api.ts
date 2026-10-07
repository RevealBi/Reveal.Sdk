// Shows the real, installed @revealbi/dom types, so code is written against the version
// in node_modules rather than from memory.
//   npm run api                              list every exported class, grouped by area
//   npm run api -- ColumnChartVisualization  print its declaration and those of its base classes
//   npm run api -- --find setLabel           list the declarations that contain a member
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";

const root = dirname(createRequire(import.meta.url).resolve("@revealbi/dom"));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

const files: string[] = [];
(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".d.ts") && name !== "index.d.ts") files.push(p);
  }
})(root);

const byName = new Map(files.map(f => [f.slice(f.lastIndexOf(sep) + 1, -5), f]));

// Drop doc comments and imports; keep the declaration itself.
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
    .filter(l => l.trim() && !l.startsWith("import ") && !/^\s*private\b/.test(l))
    .join("\n");

const [arg, value] = process.argv.slice(2);
console.log(`@revealbi/dom ${version}  (${root})\n`);

if (!arg) {
  const groups = new Map<string, string[]>();
  for (const [name, file] of byName) {
    const area = relative(root, dirname(file)) || ".";
    groups.set(area, [...(groups.get(area) ?? []), name]);
  }
  for (const [area, names] of [...groups].sort()) console.log(`${area}:\n  ${names.sort().join(", ")}\n`);
} else if (arg === "--find" && value) {
  for (const [name, file] of byName) {
    const hits = strip(readFileSync(file, "utf8")).split("\n").filter(l => l.includes(value));
    if (hits.length) console.log(`${name}:\n${hits.map(h => `  ${h.trim()}`).join("\n")}\n`);
  }
} else {
  let name: string | undefined = arg;
  const seen = new Set<string>();
  while (name && byName.has(name) && !seen.has(name)) {
    seen.add(name);
    const src: string = readFileSync(byName.get(name)!, "utf8");
    console.log(`// ${relative(root, byName.get(name)!)}\n${strip(src)}\n`);
    name = src.match(new RegExp(`class ${name}(?:<[^>]*>)? extends (\\w+)`))?.[1];
  }
  if (!seen.size) {
    console.error(`No declaration named ${arg}. Run "npm run api" for the list, or "npm run api -- --find ${arg}".`);
    process.exit(1);
  }
}
