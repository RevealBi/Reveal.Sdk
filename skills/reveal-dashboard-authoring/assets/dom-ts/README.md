# @revealbi/dom workspace (TypeScript)

A ready-to-run project for writing, type-checking and running `@revealbi/dom` code. It always installs the latest `@revealbi/dom`.

```bash
npm install
npm test                               # type-check + run every example + check the documented traps
npm run api                            # list every class in the installed @revealbi/dom
npm run api -- PivotVisualization      # print its real declaration and its base classes'
npm run api -- --find setRows          # which classes have a member
npm run inspect -- out/Sales.rdash     # what a .rdash contains (any .rdash, read-only)
npm run losscheck -- Sales.rdash       # what a round trip through the DOM would drop (add a 2nd file to compare before/after)
npm run create                         # examples: write out/Sales.rdash
npm run edit                           #           out/Sales.rdash -> out/Sales-edited.rdash
npm run sql                            #           database-connector pattern -> out/Orders.rdash
npx tsx src/my-dashboard.ts            # run your own script
```

| File | What it shows |
| --- | --- |
| `src/examples/create-sales-dashboard.ts` | Dashboard filters, KPI, column chart by month, pie, pivot and grid over the sample data, with number formatting |
| `src/examples/edit-dashboard.ts` | Load, rename, delete, reorder, and add a visualization reusing a loaded data source item |
| `src/examples/sql-server-dashboard.ts` | A database connector with explicit ids and placeholder host, no credentials |
| `src/lib/sample-data.ts` | The sample `sales` REST/JSON item, field names as constants |
| `src/lib/guard.ts` | `assertBoundFieldsExist`: catches misspelled fields and date filters bound to `"Date"` |
| `src/lib/rdash-file.ts` | `saveRdash` (guard + write), `loadRdash`, `readRdashJson` (raw JSON, no DOM) |
| `src/tools/inspect.ts`, `src/tools/api.ts`, `src/tools/losscheck.ts` | The `inspect`, `api` and `losscheck` commands |
| `test/run-all.ts` | `npm test` |

Render the output with `../preview`.

`tsconfig.json` uses `"moduleResolution": "Bundler"`. With `NodeNext` or `Node16`, TypeScript sees no exports from `@revealbi/dom` (its type declarations use extensionless directory re-exports), so every import fails to compile even though the code runs.
