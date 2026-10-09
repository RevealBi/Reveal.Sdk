---
name: reveal-dashboard-authoring
description: "The Reveal DOM: @revealbi/dom (RdashDocument, for TypeScript/JavaScript in Node or the browser) and Reveal.Sdk.Dom (.NET), the libraries for creating, editing, inspecting and deleting Reveal SDK (Reveal BI, revealbi.io) .rdash dashboards in code. Use for ANY question about the @revealbi/dom or Reveal.Sdk.Dom API (classes, setters, filters, data sources, how to do X), and for generating .rdash files, building a dashboard from a template, spec or AI output, adding, changing or removing visualizations, charts, filters or data sources in a .rdash, copying visualizations between dashboards, bulk-migrating dashboards, or explaining what a .rdash contains. Its API has non-obvious traps (date filter binding, field validation, loaded documents) that answers from memory get wrong. Includes runnable TypeScript and .NET workspaces, an API browser for the installed types, and a preview server that renders dashboards with data. Not for embedding or server setup (use reveal-embed) or other BI products."
---

# Authoring Reveal dashboards in code

A Reveal dashboard is an `.rdash` file: a zip holding one `Dashboard.json`. The Reveal DOM is an object model over that JSON, so code can create a dashboard, open one, change it and write it back without touching the JSON.

| Library | Package | Runs in | Workspace in this skill |
| --- | --- | --- | --- |
| [revealbi-dom](https://github.com/RevealBi/revealbi-dom) | `@revealbi/dom` (npm) | Node 18+ and browsers; no Reveal SDK needed | [assets/dom-ts](assets/dom-ts/README.md) |
| [Reveal.Sdk.Dom](https://github.com/RevealBi/Reveal.Sdk.Dom) | `Reveal.Sdk.Dom` (NuGet, prerelease) | .NET Framework 4.6.2+, .NET 6+ | [assets/dom-dotnet](assets/dom-dotnet/README.md) |

Pick the library that matches the code that will run it. The `.rdash` is the same either way, so a Node script can generate dashboards for an ASP.NET app.

**Always use the latest version** (`npm install @revealbi/dom@latest`; .NET: `Version="*-*"` or `dotnet add package Reveal.Sdk.Dom --prerelease`). Both libraries are pre-1.0 and their APIs move. **Write code against the installed types, not from memory**: `npm run api -- <ClassName>` in the TypeScript workspace prints the real declaration and its base classes. If an example here disagrees with the installed types, the types win.

## Work in a runnable loop

Don't hand back DOM code you haven't run. The assets make every step a command. Paths below are relative to this skill's folder, which may be `.claude/skills/`, `.github/skills/` or `.agents/skills/` depending on the agent.

1. **Set up a workspace.**
   - No suitable project yet, or a one-off job: copy `assets/dom-ts` (or `assets/dom-dotnet`) to a tools folder in the user's repository, for example `tools/dashboards/`, and run `npm install` / `dotnet build` there. Don't install into the skill folder.
   - Existing TypeScript project: `npm install @revealbi/dom@latest`, then copy `src/lib/guard.ts` and `src/lib/rdash-file.ts` from the workspace. If its `tsconfig.json` uses `"moduleResolution": "NodeNext"` or `"Node16"`, TypeScript sees no exports from `@revealbi/dom`. Use `"Bundler"` (or `"Node10"`) for the code that imports it.
   - **CommonJS code** (`require`, no `"type": "module"`, which includes most `reveal-sdk-node` servers): `require("@revealbi/dom")` returns an empty object in 0.3.0, with no error. Use `const { RdashDocument } = await import("@revealbi/dom")` ([#64](https://github.com/RevealBi/revealbi-dom/issues/64)), or put the script in an ES module (`.mjs`, or a folder whose `package.json` has `"type": "module"`).
   - Existing .NET project: add the package and copy `Guard.cs`.
2. **Read the real API.** `npm run api` lists every class; `npm run api -- PivotVisualization` shows its setters; `npm run api -- --find connectDashboardFilter` finds members. In .NET, use go-to-definition. [visualizations.md](references/visualizations.md) says which setters each visualization needs.
3. **Look before you edit.** `npm run inspect -- path/to/Existing.rdash` prints its data sources, items and declared fields, filters, and each visualization's type, bindings and filter connections. It reads any `.rdash`, including ones the DOM can't load. `npm run losscheck -- path/to/Existing.rdash` shows what saving it through the DOM would drop.
4. **Write the script.** Start from the closest example (`create-sales-dashboard`, `edit-dashboard`, `sql-server-dashboard`; in .NET, `Examples.cs`).
5. **Type-check and run it.** `npx tsc --noEmit && npx tsx src/<script>.ts`, or `dotnet run -- ...`. Save through `saveRdash` / `Examples.Save`, which run the bound-field guard first.
6. **Render it.** Copy `assets/preview` to a scratch folder **outside the user's repository** (or add it to `.gitignore`), run `npm install`, start it in the background with `npm start -- <folder with the .rdash>`, then run `npm run check -- <id>`. Read the screenshot it saves and the problem list. Exit code 0 means every widget loaded data; 3 means the only problems are the expected "Authentication not configured" errors of database connectors (check those widgets in the app); 1 means something failed, including widgets that crash the page, show "There's no data to display", or never finish drawing (a loading spinner that keeps turning). The screenshot shows about the first eight widgets; the exit code covers all of them. The preview serves sample data for item id `sales` (see its README to add your own JSON). **Stop the server when you're done** and don't leave its `logs/` or `screenshots/` in the repository. If the app already runs Reveal, opening the dashboard in the app is just as good.
7. **Run `npm test` / `dotnet run -- test`** in the workspace after upgrading the library. The tests pin down every trap listed below, so a failing test means this skill's warnings need updating.

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
| A `TimeSeriesVisualization` never renders: as built by `setDate(...)` it either crashes the Reveal client (hiding the widgets after it) or stays on its loading spinner | TypeScript | [#65](https://github.com/RevealBi/revealbi-dom/issues/65) |
| A dashboard with a Candlestick chart can't be loaded, even one the DOM created (`Chart type not supported: Candlestick`) | TypeScript | [#67](https://github.com/RevealBi/revealbi-dom/issues/67) |
| Only one dashboard date filter: every date filter gets the id `_date` | TypeScript (.NET supports several) | [PR #63](https://github.com/RevealBi/revealbi-dom/pull/63) |
| No public way to filter "top N categories by an aggregated value"; a Top N rule filters source rows. Don't bake in a list of values you computed instead: ask ([visualizations.md](references/visualizations.md#filters)) | Both | [#69](https://github.com/RevealBi/revealbi-dom/issues/69), [.NET #441](https://github.com/RevealBi/Reveal.Sdk.Dom/issues/441) |
| A dashboard with a Top N rule on a text field can't be loaded | .NET | [#437](https://github.com/RevealBi/Reveal.Sdk.Dom/issues/437) |
| A loaded item's table or schema can't be changed (`DataSourceItem.Properties` is internal) | .NET | [#438](https://github.com/RevealBi/Reveal.Sdk.Dom/issues/438) |
| A round trip drops settings of editor-made dashboards: hidden fields and custom date formats; TypeScript also sort order, grid grouping, column hyperlinks and the refresh rate ([editing.md](references/editing.md)) | Both, TypeScript more | [#73](https://github.com/RevealBi/revealbi-dom/issues/73), [#58](https://github.com/RevealBi/revealbi-dom/issues/58), [#62](https://github.com/RevealBi/revealbi-dom/issues/62), [.NET #440](https://github.com/RevealBi/Reveal.Sdk.Dom/issues/440) |

## Rules and traps

Every item here was observed by running the libraries, and the workspace tests check most of them:

- **Wrong field names fail silently.** Serialization doesn't check that bound names exist among the item's declared `fields` ([#70](https://github.com/RevealBi/revealbi-dom/issues/70)). Reveal later fails the widget with `no such column`. Save through the guard, and keep field names in constants (`Sales.Revenue`).
- **Name the field when connecting a date filter.** `connectDashboardFilter(dateFilter)` binds a field literally called `"Date"`, in both libraries. The guard catches it.
- **Set the date filter's rule.** A TypeScript `new DashboardDateFilter("Order date")` defaults to "last 365 days" (`DateRuleType.LastYear`), which hides older data. Set `ruleType = DateRuleType.AllTime` (or the rule the user wants). .NET requires a `DateFilterRule` in the constructor.
- **TypeScript: one date filter per dashboard.** Every TypeScript date filter gets the id `_date`. .NET gives each its own id.
- **Declare every field with its real type.** `setDate` on a field declared as `TextField` renders wrong numbers without an error. Values need `NumberField`, `setDate` needs `DateField`, and every field any visualization binds must be in the item's `fields` (validation throws when `fields` is empty).
- **Loaded documents differ from new ones.** Data sources and items come back as base `DataSource` / `DataSourceItem`, so `instanceof MicrosoftSqlServerDataSource` is false. Use `provider` (`"SQLSERVER"`, `"POSTGRES"`, `"REST"`, ...) and `properties`. A loaded item's `fields` is **empty**, because the declared fields sit on `visualization.dataDefinition.fields`. Copy them back before building a new visualization on that item ([editing.md](references/editing.md)).
- **No credentials in a dashboard.** Host, database and URL in the file are placeholders. The server's data source provider must overwrite them per request. Give data sources and items **explicit, stable ids** (`item.id = "Orders"`) so the provider can allow-list them. Otherwise they get GUIDs.
- **Treat generated specs as untrusted.** When a dashboard is built from user input or LLM output, allow-list the data sources, tables and fields it may reference. Never let the spec choose a host, URL, connection string or custom SQL, and cap the number of visualizations.
- **Editing editor-made dashboards is lossy.** Read [editing.md](references/editing.md) and run its loss check before changing a dashboard a person authored. If the check finds a loss, follow "Use only the DOM" above.

## References

- [typescript.md](references/typescript.md): setup, SDK registration for the browser, create, load, deliver.
- [dotnet.md](references/dotnet.md): the same for .NET, including `DateFilterRule`.
- [visualizations.md](references/visualizations.md): setters per visualization type, data fields, formatting, settings, filters, linking.
- [editing.md](references/editing.md): find, change, delete, redirect data sources, copy between dashboards, bulk migrations, round-trip losses.
