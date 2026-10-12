---
name: reveal-dashboard-authoring
description: "The Reveal DOM: @revealbi/dom (RdashDocument, for TypeScript/JavaScript in Node or the browser) and Reveal.Sdk.Dom (.NET), the libraries for creating, editing, inspecting and deleting Reveal SDK (Reveal BI, revealbi.io) .rdash dashboards in code. Use for ANY question about the @revealbi/dom or Reveal.Sdk.Dom API (classes, setters, filters, data sources, how to do X), and for generating .rdash files, building a dashboard from a template, spec or AI output, adding, changing or removing visualizations, charts, filters or data sources in a .rdash, copying visualizations between dashboards, bulk-migrating dashboards, or explaining what a .rdash contains. Its API has non-obvious traps (date filter binding, field validation, loaded documents) that answers from memory get wrong. Includes runnable TypeScript and .NET workspaces, an API browser for the installed types, and a preview server that renders dashboards with data. Not for embedding, server setup or registering data sources on the server (use reveal-embed), or other BI products."
---

# Authoring Reveal dashboards in code

A Reveal dashboard is an `.rdash` file: a zip holding one `Dashboard.json`. The Reveal DOM is an object model over that JSON, so code can create a dashboard, open one, change it and write it back without touching the JSON.

| Library | Package | Runs in | Workspace in this skill |
| --- | --- | --- | --- |
| [revealbi-dom](https://github.com/RevealBi/revealbi-dom) | `@revealbi/dom` (npm) | Node 18+ and browsers; no Reveal SDK needed | [assets/dom-ts](assets/dom-ts/README.md) |
| [Reveal.Sdk.Dom](https://github.com/RevealBi/Reveal.Sdk.Dom) | `Reveal.Sdk.Dom` (NuGet, prerelease) | .NET Framework 4.6.2+, .NET 6+ | [assets/dom-dotnet](assets/dom-dotnet/README.md) |

Pick the library that matches the code that will run it. The `.rdash` is the same either way, so a Node script can generate dashboards for an ASP.NET app.

**Always use the latest version** (`npm install @revealbi/dom@latest`; .NET: `Version="*-*"` or `dotnet add package Reveal.Sdk.Dom --prerelease`). Both libraries are pre-1.0 and their APIs move. **Write code against the installed types, not from memory**: `npm run api -- <ClassName>` in the TypeScript workspace prints the real declaration and its base classes; `dotnet run -- api <Type>` does the same in the .NET workspace. If an example here disagrees with the installed types, the types win.

## Work in a runnable loop

Don't hand back DOM code you haven't run. The assets make every step a command. Paths below are relative to this skill's folder, which may be `.claude/skills/`, `.github/skills/` or `.agents/skills/` depending on the agent.

1. **Set up a workspace.**
   - No suitable project yet, or a one-off job: copy `assets/dom-ts` (or `assets/dom-dotnet`) to a tools folder in the user's repository, for example `tools/dashboards/`, and run `npm install` / `dotnet build` there. Don't install into the skill folder.
   - Existing TypeScript project: `npm install @revealbi/dom@latest fflate`, then copy `src/lib/guard.ts` and `src/lib/rdash-file.ts` from the workspace. If its `tsconfig.json` uses `"moduleResolution": "NodeNext"` or `"Node16"`, every `@revealbi/dom` import except `RdashDocument` fails with TS2305, and `RdashDocument` silently becomes `any` (typos compile). Don't switch the whole app (changing only `moduleResolution` is error TS5095/TS5109, and Bundler hides missing `.js` extensions until run time): give the dashboard code its own folder with a `tsconfig.json` that `extends` the app's and sets `"module": "ESNext", "moduleResolution": "Bundler"`, and run it with `tsx` ([typescript.md](references/typescript.md#setup)).
   - **CommonJS code** (`require`, no `"type": "module"`, which includes most `reveal-sdk-node` servers): `require("@revealbi/dom")` fails in 0.3.0: `ReferenceError: exports is not defined` from a CommonJS file on Node 20+, `ERR_REQUIRE_ESM` on Node 18 (only `node -e` returns an empty object). Use `const { RdashDocument } = await import("@revealbi/dom")` ([#64](https://github.com/RevealBi/revealbi-dom/issues/64)), or put the script in an ES module (`.mjs`, or a folder whose `package.json` has `"type": "module"`).
   - Existing .NET project: add the package and copy `Guard.cs`. A .NET 10 single-file script can't include it: paste the class without its `namespace` line ([dotnet.md](references/dotnet.md)).
2. **Read the real API.** `npm run api` lists every class; `npm run api -- PivotVisualization` shows its setters; `npm run api -- --find connectDashboardFilter` finds members. In .NET, `dotnet run -- api ColumnChartVisualization` shows members and the extension methods that apply (`SetLabel`, `ConnectDashboardFilter`). [visualizations.md](references/visualizations.md) says which setters each visualization needs.
3. **Look before you edit.** `npm run inspect -- path/to/Existing.rdash` prints its data sources, items and declared fields, filters (date filter rules included), links, and each visualization's type, bindings and filter connections. It reads any `.rdash`, including ones the DOM can't load. `npm run losscheck -- path/to/Existing.rdash` shows what saving it through the DOM would drop or add.
4. **Write the script.** Start from the closest example (`create-sales-dashboard`, `edit-dashboard`, `sql-server-dashboard`; in .NET, `Examples.cs`).
5. **Type-check and run it.** `npx tsc --noEmit && npx tsx src/<script>.ts`, or `dotnet run -- ...`. Save through `saveRdash` / `Examples.Save`, which run the guard first: bound fields exist, no date column bound as a label, dashboard-filter fields, link parameters and filter binding targets. When editing a loaded file, pass its original JSON (`saveRdash(doc, path, await readRdashJson(src))`) so only new problems fail. `npm run guard -- <file>` / `dotnet run -- guard <file>` checks an existing `.rdash`.
6. **Render it.** Copy `assets/preview` to a scratch folder **outside the user's repository** (or add it to `.gitignore`), run `npm install`, start it in the background with `npm start -- <folder with the .rdash>`, then run `npm run check -- <id>`. Read the screenshot it saves and the problem list. Exit 0 means no widget reported an error, crashed, stayed empty or kept spinning; 3 means the only problems are database connectors the preview doesn't serve (check those in the app); 1 means something failed. `check` scrolls through the whole dashboard, but the screenshot shows about the first eight widgets. **Exit 0 is not proof**: a misspelled grid column, a filter or link that filters nothing and a chart that draws nothing (an empty map) all pass, so also run the guard and `inspect` ([preview README](assets/preview/README.md#what-check-cant-see)). The preview is default-deny (only its sample items get data: id `sales`; its README says how to add your own JSON), which makes it safe for generated or untrusted dashboards: never preview one in an app whose providers pass items through, and don't loosen the preview's provider. **Stop the server when you're done**, and stop only the process you started (keep its PID or background job): never kill all `node` or `dotnet` processes. Don't leave its `logs/` or `screenshots/` in the repository. If the app already runs Reveal, opening the dashboard in the app is just as good.
7. **Run `npm test` / `dotnet run -- test`** in the workspace after upgrading the library. A failing test or build means this skill's warnings need re-checking; drift often shows first as a compile or build error. The tests cover most rules below, not all: there is no test for gauge bounds, field types (`setDate` on a `TextField`), the TypeScript join gap, NodeNext typing, Top N or the .NET load gaps, and the TimeSeries and ScatterMap rows are tested only as what the .NET library writes (the crash and the empty map need a render).

## Where the dashboard goes

| Target | TypeScript | .NET |
| --- | --- | --- |
| A `.rdash` file (dashboards folder, a store) | `saveRdash(doc, path)` (or `Buffer.from(await doc.toBlob().arrayBuffer())`) | `document.Save(path)` |
| Returned by the server's dashboard provider at request time | Node: `Readable.from(Buffer.from(await doc.toBlob().arrayBuffer()))` | ASP.NET: `Dashboard.FromJsonString(document.ToJsonString())` |
| Into a `RevealView` in the browser | `view.dashboard = await doc.toRVDashboard()` (register `reveal-sdk` first, typescript.md) | WPF: `await RVDashboard.LoadFromJsonAsync(document.ToJsonString())` |
| A database column | `doc.toJsonString()` / `RdashDocument.loadFromJson(json)` | `ToJsonString()` / `RdashDocument.LoadFromJson(json)` |

When the app runs on Reveal (`reveal-embed` skill), its provider rules still apply: validate the dashboard id, authorize the user, and keep saves going through the same authorized path.

## Use only the DOM

**Never write, patch or string-edit `Dashboard.json` (or the `.rdash` zip) yourself**, not even as a workaround. Every change goes through `@revealbi/dom` or `Reveal.Sdk.Dom`: load, change objects, serialize.

When the DOM can't do what the user asked, or doing it through the DOM would lose something the dashboard has (see the gaps below and the round-trip table in [editing.md](references/editing.md)):

1. Stop before writing anything. Tell the user what the DOM can't do and what it would cost them (for example "saving through the DOM drops the custom date format on 5 fields").
2. Offer an issue for the library's repository ([revealbi-dom](https://github.com/RevealBi/revealbi-dom/issues) or [Reveal.Sdk.Dom](https://github.com/RevealBi/Reveal.Sdk.Dom/issues)): a title, the installed version, a minimal repro script, expected vs actual. Draft it; don't file it unless the user asks.
3. Ask the user how to proceed: skip that part, make the change in the Reveal editor, or have you edit the JSON by hand as a one-off. Edit the JSON only after the user explicitly agrees, keep the original file, and say in your summary which parts were edited outside the DOM.

A DOM-only substitute that shows the same live data (a line chart by day where a time series was asked for) is fine: use it and say so in your summary. A substitute that behaves differently over time or with other data, such as a fixed list of values computed once while generating instead of a live Top N rule, is an option to **offer** in step 3, not a fix to apply.

Known gaps, verified against `@revealbi/dom` 0.3.0, `Reveal.Sdk.Dom` 0.1.688 and Reveal 2.2.1:

| Gap | Library | Tracked in |
| --- | --- | --- |
| A `TimeSeriesVisualization` whose date field has no `DateFormatting` crashes the Reveal client (`reading 'dateFormat'`), hiding the widgets after it. Workaround: `dateField.formatting = new DateFormatting("dd-MMM-yyyy")` ([visualizations.md](references/visualizations.md)) | Both | [#65](https://github.com/RevealBi/revealbi-dom/issues/65) |
| A `ScatterMap` renders an empty map (no error) unless its zoom rectangle is set ([visualizations.md](references/visualizations.md)); a TypeScript round trip also corrupts an existing map's zoom | Both; round trip TypeScript | (issue draft) |
| A dashboard with a Candlestick chart can't be loaded, even one the DOM created (`Chart type not supported: Candlestick`) | TypeScript | [#67](https://github.com/RevealBi/revealbi-dom/issues/67) |
| Only one dashboard date filter: every date filter gets the id `_date` | TypeScript (.NET supports several) | [PR #63](https://github.com/RevealBi/revealbi-dom/pull/63) |
| No public way to filter "top N categories by an aggregated value"; a Top N rule filters source rows. Don't bake in a list of values you computed instead: ask ([visualizations.md](references/visualizations.md#filters)) | Both | [#69](https://github.com/RevealBi/revealbi-dom/issues/69), [.NET #441](https://github.com/RevealBi/Reveal.Sdk.Dom/issues/441) |
| A dashboard with a Top N rule on a text field can't be loaded | .NET | [#437](https://github.com/RevealBi/Reveal.Sdk.Dom/issues/437) |
| A loaded item's table or schema can't be changed (`DataSourceItem.Properties` is internal) | .NET | [#438](https://github.com/RevealBi/Reveal.Sdk.Dom/issues/438) |
| A round trip changes editor-made dashboards: drops hidden fields, custom date formats and the K/M number format, adds a number format where there was none; TypeScript also drops sort order, grid grouping, column hyperlinks, the refresh rate, read-only filters and **relative date rules** ("Last 2 weeks", .NET `DateFilterRule.Last`), after which Reveal can't open the dashboard ([editing.md](references/editing.md)) | Both, TypeScript more | [#73](https://github.com/RevealBi/revealbi-dom/issues/73), [#58](https://github.com/RevealBi/revealbi-dom/issues/58), [#62](https://github.com/RevealBi/revealbi-dom/issues/62), [.NET #440](https://github.com/RevealBi/Reveal.Sdk.Dom/issues/440) |
| On a **loaded** dashboard, connecting a new widget to its date filter binds the target `_date`, which the loaded filter doesn't have: the widget is unfiltered, no error (rendered with two date filters). The guard flags it ([editing.md](references/editing.md#connecting-to-a-loaded-date-filter)) | TypeScript | (issue draft) |
| A load + save rewrites the editor's id-less date binding to `_date` while the filter keeps its GUID (4 of 350 editor dashboards). Not verified whether Reveal still applies the filter; the guard flags it, so `saveRdash`, `roundtrip` and `migrate` stop on those files ([editing.md](references/editing.md#connecting-to-a-loaded-date-filter)) | Both | (unverified) |
| `import(..., includeDashboardFilters)` doesn't copy the date filter; the copy shows all-time data and its date binding points at a missing filter ([editing.md](references/editing.md#copy-visualizations-between-dashboards)) | TypeScript; both for the editor's id-less date binding (.NET copies a GUID date filter: test, not rendered) | (issue draft) |
| A link whose `LinkFilter` value isn't a source column (the library's sample passes the target filter's title) opens the target **unfiltered**, no error ([visualizations.md](references/visualizations.md#linking)) | TypeScript | [#71](https://github.com/RevealBi/revealbi-dom/issues/71) |
| No join API; joins exist only in .NET (`item.Join`) | TypeScript | (issue draft) |

## Rules and traps

Every item here was observed by running the libraries, and the workspace tests check most of them:

- **Wrong field names fail silently.** Serialization doesn't check that bound names exist among the item's declared `fields` ([#70](https://github.com/RevealBi/revealbi-dom/issues/70)). Reveal later fails the widget with `no such column`. Save through the guard, and keep field names in constants (`Sales.Revenue`) ([typescript.md](references/typescript.md#validation)).
- **Name the field when connecting a date filter.** `connectDashboardFilter(dateFilter)` binds a field literally called `"Date"`, in both libraries. The plural `connectDashboardFilters(date, region)` does the same, and Reveal then ignores **every** dashboard filter on that widget, the correct ones too. Connect each filter on its own. The guard catches it ([visualizations.md](references/visualizations.md#filters)).
- **Setters replace, they don't add.** Every setter call, plural included, replaces that binding: pass all fields in one call ([visualizations.md](references/visualizations.md)).
- **Never bind a date column by name as a label or row.** `setLabel("OrderDate")` breaks the widget; pass a `DateDataField` ([visualizations.md](references/visualizations.md)).
- **Build custom date ranges in UTC.** A local `new Date(2026, 0, 1)` (.NET `DateTimeKind.Local`, `DateTime.Today`) is written as the previous day east of UTC, and Reveal filters that day. Use `new Date(Date.UTC(2026, 0, 1))` / an unspecified or UTC `DateTime` ([visualizations.md](references/visualizations.md#filters)).
- **Links fail silently.** A `LinkFilter` value must be the source column; a wrong one opens the target unfiltered ([visualizations.md](references/visualizations.md#linking)).
- **Set both gauge bounds.** A `CircularGauge` with only `maximum` set crashes the client ([visualizations.md](references/visualizations.md#which-setters-each-visualization-needs)).
- **Set the date filter's rule.** A TypeScript `new DashboardDateFilter("Order date")` defaults to "last 365 days" (`DateRuleType.LastYear`), which hides older data. Set `ruleType = DateRuleType.AllTime` (or the rule the user wants). .NET requires a `DateFilterRule` in the constructor ([dotnet.md](references/dotnet.md#date-filters)).
- **TypeScript: one date filter per dashboard, and only on dashboards it created.** Every TypeScript date filter binding targets the id `_date` (.NET gives each filter its own id). On a loaded editor- or .NET-made dashboard, a new connection to its date filter is silently dead: use .NET for that edit, or ask ([editing.md](references/editing.md#connecting-to-a-loaded-date-filter)).
- **TypeScript has no join API.** A hand-built join compiles and passes the guard but fails every widget. Join in .NET (`item.Join`), in a database view, or in the server's data ([typescript.md](references/typescript.md#load-an-existing-dashboard)).
- **Declare every field with its real type.** `setDate` on a field declared as `TextField` renders wrong numbers without an error. Values need `NumberField`, `setDate` needs `DateField`, and every field any visualization binds must be in the item's `fields` (validation throws when `fields` is empty) ([visualizations.md](references/visualizations.md#data-fields-with-options)).
- **Loaded documents differ from new ones.** Data sources and items come back as base `DataSource` / `DataSourceItem`, so `instanceof MicrosoftSqlServerDataSource` is false. Use `provider` (`"SQLSERVER"`, `"POSTGRES"`, `"REST"`, ...) and `properties`. A loaded item's `fields` is **empty**, because the declared fields sit on `visualization.dataDefinition.fields`. Copy them back before building a new visualization on that item ([editing.md](references/editing.md)).
- **No credentials in a dashboard.** Host, database and URL in the file are placeholders. The server's data source provider must overwrite them per request. Give data sources and items **explicit, stable ids** (`item.id = "Orders"`) so the provider can use them as allow-list lookup keys. Treat incoming ids as client-controlled: authorize the current user for the mapped source and replace all source/query details server-side; possession of an id is not permission. Otherwise generated items get GUIDs ([typescript.md](references/typescript.md#create-a-dashboard)).
- **Treat generated specs as untrusted.** When a dashboard is built from user input or LLM output, allow-list the data sources, tables and fields it may reference. Never let the spec choose a host, URL, connection string or custom SQL, and cap the number of visualizations. Start from [spec-generator.ts](assets/dom-ts/src/examples/spec-generator.ts) (`npm run spec`).
- **Per-tenant dashboards don't isolate data.** A template or a preselected filter is not isolation: users can change dashboard filters. Scope the data on the server from the user context (tenant in the user-context properties, restricted query or table in the data source provider; [typescript.md](references/typescript.md#write-it-out)); see the `reveal-embed` skill.
- **.NET: don't `Save` over an existing, larger file.** It leaves a corrupt zip that strict readers reject. Save to a temp file and move it over ([dotnet.md](references/dotnet.md)).
- **Editing editor-made dashboards is lossy.** Read [editing.md](references/editing.md) and run its loss check before changing a dashboard a person authored. If the TypeScript check finds a loss, try the .NET library (`dotnet run -- roundtrip`, see editing.md). Follow "Use only the DOM" above only if no DOM path keeps the settings.

## References

- [typescript.md](references/typescript.md): setup, SDK registration for the browser, create, load, deliver.
- [dotnet.md](references/dotnet.md): the same for .NET, including `DateFilterRule`.
- [visualizations.md](references/visualizations.md): setters per visualization type, data fields, formatting, settings, filters, linking.
- [editing.md](references/editing.md): find, change, delete, redirect data sources, copy between dashboards, bulk migrations, round-trip losses.
