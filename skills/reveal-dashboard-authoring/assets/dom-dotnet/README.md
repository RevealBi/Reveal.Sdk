# Reveal.Sdk.Dom workspace (.NET)

A console project for writing and running `Reveal.Sdk.Dom` code. `Version="*-*"` always restores the newest prerelease. Requires the .NET 8 SDK or later; it targets `net8.0` and rolls forward to a newer runtime when .NET 8 isn't installed.

```bash
dotnet run -- test                     # build + run every example + check the documented traps
dotnet run -- create                   # out/Sales.rdash
dotnet run -- edit                     # out/Sales.rdash -> out/Sales-edited.rdash
dotnet run -- sql                      # database-connector pattern -> out/Orders.rdash
dotnet run -- guard <file> [<original>]           # field, filter, connection and link checks on any .rdash
dotnet run -- roundtrip <in> <out> [--allow-loss] # load + save to a new path; refuses a user-visible loss
dotnet run -- migrate <folder> [--out <dir>] [--allow-loss]   # the same per file, with Migration.Change applied
dotnet run -- api [Type or filter]                # the installed package's types, members and extension methods
```

| File | What it shows |
| --- | --- |
| `Examples.cs` | `CreateSalesDashboard` (filters, KPI, charts, pivot, grid, formatting), `EditDashboard` (rename, delete, reorder, add one reusing a loaded item), `CreateOrdersDashboard` (database connector), `Save` (guard + safe write) |
| `SampleData.cs` | The sample `sales` REST/JSON item, field names as constants |
| `Guard.cs` | `AssertBoundFieldsExist`: misspelled fields (visualizations and dashboard filters), date filters bound to `"Date"`, date columns bound by name, connections to missing filters, link parameters that aren't source columns. Pass the original JSON as the baseline when editing an existing dashboard |
| `Workspace.cs` | `WriteRdash` (temp file + move: `RdashDocument.Save` over a larger file corrupts it), `Convert` / `Migrate` (never write the input; refuse lossy writes unless `--allow-loss`) |
| `LossCheck.cs` | What a round trip lost, compared with the original `Dashboard.json` (the TypeScript workspace's `losscheck` rules) |
| `Migration.cs` | The change `migrate` applies to each dashboard: edit it |
| `ApiBrowser.cs` | The `api` command |
| `Program.cs` | The commands and the `test` checks (25 tests: examples, traps, guard rules, safe save, import, roundtrip, migrate) |

Render the output with `../preview` (`npm start -- ../dom-dotnet/out`), which needs Node.js. For the real API surface, run `dotnet run -- api <Type>` or use IntelliSense. The source is at https://github.com/RevealBi/Reveal.Sdk.Dom.
