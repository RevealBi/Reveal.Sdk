# @revealbi/dom workspace (TypeScript)

A ready-to-run project for writing, type-checking and running `@revealbi/dom` code. It always installs the latest `@revealbi/dom`.

```bash
npm install
npm test                               # type-check + run every example + check the documented traps
npm run api                            # list every class in the installed @revealbi/dom
npm run api -- PivotVisualization      # print its real declaration and its base classes'
npm run api -- --find setRows          # which classes have a member
npm run inspect -- out/Sales.rdash     # what a .rdash contains: sources, fields, filters (date rules), links, bindings and their targets
npm run guard -- out/Sales.rdash       # the guard on any .rdash (exit 1 lists the problems, 2 = can't read it)
npm run losscheck -- Sales.rdash       # what a round trip through the DOM would drop or add (add a 2nd file to compare before/after; exit 1 = visible loss, 2 = can't read/load)
npm run migrate -- <folder> [--out <dir>] [--allow-loss]   # bulk migration: your change in src/tools/migrate.ts, guard + loss check per file, writes <folder>-migrated, refuses lossy files
npm run spec -- [spec.json] [out.rdash]  # dashboard from an untrusted JSON spec, allow-listed against a server-side catalog (exit 4 = rejected)
npm run create                         # examples: write out/Sales.rdash
npm run app-json -- <path>             #           KPI, column, line, grid on a JSON file the app serves -> out/SalesOverview.rdash
npm run edit                           #           out/Sales.rdash -> out/Sales-edited.rdash
npm run sql                            #           database-connector pattern -> out/Orders.rdash
npx tsx src/my-dashboard.ts            # run your own script
```

| File | What it shows |
| --- | --- |
| `src/examples/create-sales-dashboard.ts` | Dashboard filters, KPI, column chart by month, pie, pivot and grid over the sample data, with number formatting |
| `src/examples/app-json-dashboard.ts` | The one to copy for a dashboard on a JSON file the app serves: a `jsonFileItem`, then a KPI, column chart, line chart by month and grid |
| `src/examples/edit-dashboard.ts` | Load, rename, delete, reorder, and add a visualization reusing a loaded data source item |
| `src/examples/sql-server-dashboard.ts` | A database connector with explicit ids and placeholder host, no credentials |
| `src/lib/sample-data.ts` | `jsonFileItem(id, title, fields)` for a JSON file the app serves, and the sample `sales` item built with it, field names as constants |
| `src/lib/guard.ts` | `assertBoundFieldsExist`: catches misspelled fields, date filters bound to `"Date"` (plural `connectDashboardFilters` included), dashboard-filter fields the item lacks, a date column bound by name as a label or row, `LinkFilter` values that aren't source columns, bindings to a filter the dashboard doesn't have, and REST items without their JSON wrapper |
| `src/examples/spec-generator.ts` | A dashboard from a user or LLM spec that may only name catalog entries: exact key lists, field and binding checks, size caps, every problem reported at once (`npm run spec`) |
| `src/lib/rdash-file.ts` | `saveRdash(doc, path, original?)` (serializes once, guard, writes a temp file and renames it over the target; pass the original JSON when editing), `loadRdash`, `readRdashJson` (raw JSON, no DOM; tolerates trailing commas) |
| `src/tools/inspect.ts`, `src/tools/api.ts`, `src/tools/losscheck.ts`, `src/tools/guard.ts` | The `inspect`, `api`, `losscheck` and `guard` commands |
| `src/tools/migrate.ts` | The `migrate` command; edit its `migrate(doc)` function. Never writes the input folder; logs to `<out>/migrate-log.txt` |
| `test/run-all.ts` | `npm test` (46 tests): type-check, run the examples, check most documented traps (`trap:` tests hold today and fail with a "fixed: update ..." message when the library changes; `gap:` tests fail when the library fixes the gap), and test the guard, losscheck, inspect, spec and migrate tools. Not every trap has a test (SKILL.md step 7 lists the ones without), and a library upgrade often shows first as a compile error |

Render the output with `../preview`.

`tsconfig.json` uses `"moduleResolution": "Bundler"`. With `NodeNext` or `Node16`, every import from `@revealbi/dom` except `RdashDocument` fails to compile (its type declarations use extensionless directory re-exports), and `RdashDocument` silently becomes `any`, even though the code runs. In a NodeNext app, give the dashboard code its own `tsconfig.json` that extends the app's with `"module": "ESNext", "moduleResolution": "Bundler"` (typescript.md, Setup).
