# Preview server

Renders `.rdash` files in a real Reveal server, so a generated or edited dashboard can be checked by looking at it, not just by serializing it. It's anonymous, read-only and bound to 127.0.0.1, for local use only. Never deploy it.

```bash
npm install
npm start -- ../dom-ts/out            # or ../dom-dotnet/out, or any folder of .rdash files
# http://localhost:5112/  lists them; ?dashboard=<id> opens one
npm run check -- Sales                # in a second terminal: headless render + error report
```

`public/client-side.html` is the browser example: it loads `reveal-sdk` and `@revealbi/dom` from script tags, builds a dashboard in the page, and renders it with `toRVDashboard()`. With `?dashboard=<id>`, it loads a server dashboard through `RdashDocument.load(id)`, edits it, and renders the result. Check it with `npm run check -- --page client-side.html [id]`.

`check` uses an installed Chrome or Microsoft Edge (through `playwright-core`, no browser download). It saves `screenshots/<id>.png` (about the first eight widgets), prints the visible text and a problem list, and exits with:

| Exit | Meaning |
| --- | --- |
| 0 | Every widget loaded data. |
| 3 | The only problems are `Authentication not configured` from database connectors, which is expected here. Check those widgets in the app. |
| 1 | Something failed: a widget request, an uncaught page error (a visualization that crashes while drawing), a widget showing "There's no data to display", or a widget that never finishes drawing (the page is still moving a moment after loading, usually a loading spinner). The exit code covers widgets below the screenshot too. |
| 2 | Usage error, or no Chrome/Edge found. |

A coding agent should read the PNG and the problem list.

Run the preview from a scratch folder outside the app's repository (or gitignore it): it writes `logs/` and `screenshots/`. Stop the server when you're done; it keeps a Reveal engine process running.

## Data

REST/JSON items whose **id** is listed in `SAMPLE_DATA` in `server.js` are pointed at the files in `sample-data/`. The URL stored in the dashboard doesn't matter. Every other URL, host or file is blocked, the same allow-list rule the reveal-embed skill requires of a real app.

| Item id | File | Fields |
| --- | --- | --- |
| `sales` | `sample-data/sales.json` (439 orders, Jan 2025 to Sep 2026) | `OrderId` number, `OrderDate` date, `Region`, `Product`, `Category` text, `Quantity`, `Revenue` number |

To preview a dashboard over your own data, add the JSON file to `sample-data/` and its item id to `SAMPLE_DATA`.

Widgets bound to a real database (SQL Server, Postgres, ...) report "Authentication not configured" here, which is expected (exit code 3). The check still proves that the dashboard loads, its title and filters appear, and nothing else fails. Check those widgets in the app itself.

## What the errors mean

| `check` reports | Cause |
| --- | --- |
| `no such column: X` | The visualization binds a field the data doesn't have. Run the bound-field guard; the item's declared fields don't match the data. |
| `Authentication not configured {"ds-id":"..."}` | A database connector, expected in the preview (exit 3). |
| `page error: Cannot read properties of null (reading 'dateFormat')` | A visualization crashed while drawing; with `@revealbi/dom` 0.3.0 this is a `TimeSeriesVisualization` (SKILL.md, known gaps). |
| `something is still moving after the wait` | A widget got its data but never drew and keeps its loading spinner turning, with no error anywhere. With `@revealbi/dom` 0.3.0 this is a `TimeSeriesVisualization`. |
| `N widget(s) show "There's no data to display"` | The query returned no rows: a filter that excludes everything (a date filter's default is the last 365 days), a wrong field type, or data that doesn't match. |
| `Could not load "<id>"` on the page | The file is missing from the folder, or the id has characters other than letters, digits, `-` and `_`. |
| Widget errors with no further detail | Read `logs/` (the engine log). |
