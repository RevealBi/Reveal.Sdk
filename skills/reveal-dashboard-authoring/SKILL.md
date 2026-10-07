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
   - Existing .NET project: add the package and copy `Guard.cs`.
2. **Read the real API.** `npm run api` lists every class; `npm run api -- PivotVisualization` shows its setters; `npm run api -- --find connectDashboardFilter` finds members. In .NET, use go-to-definition. [visualizations.md](references/visualizations.md) says which setters each visualization needs.
3. **Look before you edit.** `npm run inspect -- path/to/Existing.rdash` prints its data sources, items and declared fields, filters, and each visualization's type, bindings and filter connections. It reads any `.rdash`, including ones the DOM can't load.
4. **Write the script.** Start from the closest example (`create-sales-dashboard`, `edit-dashboard`, `sql-server-dashboard`; in .NET, `Examples.cs`).
5. **Type-check and run it.** `npx tsc --noEmit && npx tsx src/<script>.ts`, or `dotnet run -- ...`. Save through `saveRdash` / `Examples.Save`, which run the bound-field guard first.
6. **Render it.** Copy `assets/preview` next to the workspace (for example `tools/dashboard-preview/`), run `npm install`, start it with `npm start -- <folder with the .rdash>`, then run `npm run check -- <id>` in a second shell. Read the screenshot it saves and the error list. Exit code 0 means every widget loaded its data. The preview serves sample data for item id `sales` (see its README to add your own JSON). Widgets on a real database show a connection error there, which is expected; check those in the app. If the app already runs Reveal, opening the dashboard in the app is just as good.
7. **Run `npm test` / `dotnet run -- test`** in the workspace after upgrading the library. The tests pin down every trap listed below, so a failing test means this skill's warnings need updating.

## Where the dashboard goes

| Target | TypeScript | .NET |
| --- | --- | --- |
| A `.rdash` file (dashboards folder, a store) | `saveRdash(doc, path)` (or `Buffer.from(await doc.toBlob().arrayBuffer())`) | `document.Save(path)` |
| Returned by the server's dashboard provider at request time | Node: `Readable.from(Buffer.from(await doc.toBlob().arrayBuffer()))` | ASP.NET: `Dashboard.FromJsonString(document.ToJsonString())` |
| Into a `RevealView` in the browser | `view.dashboard = await doc.toRVDashboard()` (register `reveal-sdk` first, typescript.md) | WPF: `await RVDashboard.LoadFromJsonAsync(document.ToJsonString())` |
| A database column | `doc.toJsonString()` / `RdashDocument.loadFromJson(json)` | `ToJsonString()` / `RdashDocument.LoadFromJson(json)` |

When the app runs on Reveal (`reveal-embed` skill), its provider rules still apply: validate the dashboard id, authorize the user, and keep saves going through the same authorized path.

## Rules and traps

Every item here was observed by running the libraries, and the workspace tests check them:

- **Wrong field names fail silently.** Serialization doesn't check that bound names exist among the item's declared `fields`. Reveal later fails the widget with `no such column`. Save through the guard, and keep field names in constants (`Sales.Revenue`).
- **Name the field when connecting a date filter.** `connectDashboardFilter(dateFilter)` binds a field literally called `"Date"`, in both libraries. The guard catches it.
- **TypeScript: one date filter per dashboard.** Every TypeScript date filter gets the id `_date`. .NET gives each its own id.
- **Declare every field with its real type.** Values need `NumberField`, `setDate` needs `DateField`, and every field any visualization binds must be in the item's `fields` (validation throws when `fields` is empty).
- **Loaded documents differ from new ones.** Data sources and items come back as base `DataSource` / `DataSourceItem`, so `instanceof MicrosoftSqlServerDataSource` is false. Use `provider` (`"SQLSERVER"`, `"POSTGRES"`, `"REST"`, ...) and `properties`. A loaded item's `fields` is **empty**, because the declared fields sit on `visualization.dataDefinition.fields`. Copy them back before building a new visualization on that item ([editing.md](references/editing.md)).
- **No credentials in a dashboard.** Host, database and URL in the file are placeholders. The server's data source provider must overwrite them per request. Give data sources and items **explicit, stable ids** (`item.id = "Orders"`) so the provider can allow-list them. Otherwise they get GUIDs.
- **Treat generated specs as untrusted.** When a dashboard is built from user input or LLM output, allow-list the data sources, tables and fields it may reference. Never let the spec choose a host, URL, connection string or custom SQL, and cap the number of visualizations.
- **Never hand-write or string-edit `Dashboard.json`.** Load it into the DOM, change objects, serialize.
- **Editing editor-made dashboards is slightly lossy.** A round trip drops hidden-field flags and custom field date formats, and TypeScript 0.3.0 can't load Candlestick charts. Read [editing.md](references/editing.md) before changing dashboards a person authored.

## References

- [typescript.md](references/typescript.md): setup, SDK registration for the browser, create, load, deliver.
- [dotnet.md](references/dotnet.md): the same for .NET, including `DateFilterRule`.
- [visualizations.md](references/visualizations.md): setters per visualization type, data fields, formatting, settings, filters, linking.
- [editing.md](references/editing.md): find, change, delete, redirect data sources, copy between dashboards, bulk migrations, round-trip losses.
