# Reveal.Sdk.Dom workspace (.NET)

A console project for writing and running `Reveal.Sdk.Dom` code. `Version="*-*"` always restores the newest prerelease. Requires the .NET 8 SDK or later.

```bash
dotnet run -- test                     # build + run every example + check the documented traps
dotnet run -- create                   # out/Sales.rdash
dotnet run -- edit                     # out/Sales.rdash -> out/Sales-edited.rdash
dotnet run -- sql                      # database-connector pattern -> out/Orders.rdash
```

| File | What it shows |
| --- | --- |
| `Examples.cs` | `CreateSalesDashboard` (filters, KPI, charts, pivot, grid, formatting), `EditDashboard` (rename, delete, reorder, add one reusing a loaded item), `CreateOrdersDashboard` (database connector), `Save` (guard + write) |
| `SampleData.cs` | The sample `sales` REST/JSON item, field names as constants |
| `Guard.cs` | `AssertBoundFieldsExist`: catches misspelled fields and date filters bound to `"Date"` |
| `Program.cs` | The commands and the `test` checks |

Render the output with `../preview` (`npm start -- ../dom-dotnet/out`), which needs Node.js. For the real API surface, use IntelliSense or go-to-definition on the package types. The source is at https://github.com/RevealBi/Reveal.Sdk.Dom.
