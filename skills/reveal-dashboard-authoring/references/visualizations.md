# Visualizations, fields and filters

Names below are the TypeScript ones. In .NET the same classes and methods are PascalCase (`setLabel` → `SetLabel`). Every visualization takes `(title, dataSourceItem)` (`TextBox` takes only a title), and every setter returns the visualization so calls chain.

## Which setters each visualization needs

A setter takes a field name string or a typed data field (`NumberDataField`, `DateDataField`, `TextDataField`) when the binding needs options; `Grid` and `TextView` columns take names only. Where a binding takes several fields there is a plural form (`setValue` / `setValues`, `setLabel` / `setLabels`). **Every call replaces that binding**, plural included: `setValues("Revenue").setValues("Quantity")` keeps only Quantity. Pass all fields in one call: `setValues(revenue, "Quantity")` in TypeScript; in .NET the `params` overloads are either all strings or all typed fields, so write `SetValues(revenue, new NumberDataField("Quantity"))`.

A **date** column used as a label, row, column or category needs a `DateDataField` with an `aggregationType`. Passed by name it is written as a plain dimension and the widget fails (`Specified cast is not valid` from TypeScript-made files, a spinner that never stops from .NET-made ones); the guard catches it. `setDate` is the exception and takes the name.

| Visualization classes | Bind with |
| --- | --- |
| `ColumnChart`, `BarChart`, `LineChart`, `AreaChart`, `SplineChart`, `SplineAreaChart`, `StepLineChart`, `StepAreaChart`, `StackedColumnChart`, `StackedBarChart`, `StackedAreaChart`, `Radial` | `setLabel` (category axis), `setValues` (all value fields in one call), optional `setCategory` (series split), `addFixedLine(new FixedLineFixedValue(20000, "Goal"))` (also `FixedLineAverage`, `FixedLineData(field)`, `FixedLineMinimum/Maximum`) |
| `PieChart`, `DoughnutChart`, `FunnelChart` | `setLabel`, `setValue` |
| `ComboChart` | `setLabel`, `setChart1Values`, `setChart2Values`; the series types in `configureSettings(s => { s.chart1Type = ComboChartType.Column; s.chart2Type = ComboChartType.Line; })` |
| `Scatter`, `Bubble` | `setLabel`, `setXAxis`, `setYAxis`, plus `setRadius` (bubble) |
| `KpiTime` | `setDate`, `setValue`, optional `setCategories([...])`. The comparison period is `configureSettings(s => s.timePeriod = KpiTimePeriod.YearToDatePreviousYear)` (the default); a month-to-date period shows "no data" when the data has none this month |
| `KpiTarget` | `setDate`, `setValue`, `setTarget`; period: `configureSettings(s => s.goalPeriod = KpiGoalPeriod.YearToDate)` |
| `Sparkline` | `setDate`, `setValue`, optional `setCategory` |
| `TimeSeries` | `setDate`, `setValue`, optional `setCategory`. **Give the date field a format, or it doesn't render** in either library (the Reveal client crashes reading a null `dateFormat`, [#65](https://github.com/RevealBi/revealbi-dom/issues/65)): `const d = new DateDataField("OrderDate"); d.aggregationType = DateAggregationType.Day; d.formatting = new DateFormatting("dd-MMM-yyyy"); ts.setDate(d)`. The default aggregation is `Year` |
| `CircularGauge`, `Text` (single value) | `setLabel`, `setValue`. If you set gauge bounds in `configureSettings`, set **both** `minimum` and `maximum` (`const b = new Bound(); b.valueType = BoundValueType.NumberValue; b.value = 200000;`): a `CircularGauge` with only `maximum` crashes the client |
| `LinearGauge`, `BulletGraph` | `setLabel`, `setValue`, plus `setTarget` (bullet) |
| `Grid`, `TextView` | `setColumns("a", "b", ...)` |
| `Pivot` | `setRows([...])`, `setColumns([...])`, `setValues(...)` |
| `TreeMap` | `setLabels(...)`, `setValue` |
| `Choropleth` | `setMap(Maps.WorldCountries)` (or another `Maps` entry), `setLocation` (a column whose values are names on that map: country names for `WorldCountries`), `setValue` |
| `ScatterMap` | `setMap(...)`, `setLatitude`, `setLongitude` (number columns), `setLabel`, optional `setColorByValue` / `setColorByCategory`, **and the visible area**, or it renders an empty map: TS `configureSettings(s => { const z = new MapZoomRectangle(); z.longitude = -180; z.latitude = -60; z.degreesLongitude = 360; z.degreesLatitude = 150; s.zoom = z; })`; .NET `ConfigureSettings(s => { s.Zoom.Longitude = -180; s.Zoom.Latitude = -60; s.Zoom.DegreesLongitude = 360; s.Zoom.DegreesLatitude = 150; })` |
| `CandleStick`, `OHLC` | `setLabel`, `setOpen`, `setHigh`, `setLow`, `setClose`. Both render; but TypeScript can't load a dashboard that contains a Candlestick, even its own ([#67](https://github.com/RevealBi/revealbi-dom/issues/67)), so prefer `OHLC` when the dashboard will be edited with the TypeScript DOM |
| `TextBox` | `new TextBoxVisualization(title)` (no data source item), then `setText`, `setFontSize`, `setAlignment` |
| `Image` | `setUrl(field)`: binds a **column** that holds image URLs, so it needs a data source item. Reveal fetches each image on the server through the app's data source item provider (a web resource item with the image URL), so the image host must be allowed there: each fetch arrives with a new random item id, so allow it by URL prefix, not by id, and treat the URL column as untrusted; the preview blocks it |
| `Custom` | `setUrl` (a page that implements Reveal's custom visualization API), `setRows`, `setColumns([...])`, `setValues`; no `configureSettings` |

Each class is `<Name>Visualization` (`ColumnChartVisualization`, `KpiTimeVisualization`, ...).

**Array or rest parameters vary.** In the TypeScript library:

| Takes an **array** | Takes **one or more separate arguments** |
| --- | --- |
| `Pivot.setRows([...])`, `Pivot.setColumns([...])`, `Custom.setColumns([...])`, `setCategories([...])`, `setXAxes([...])`, `setYAxes([...])` | `setValues("a", "b")`, `setLabels("a", "b")`, `Grid.setColumns("a", "b")`, `Custom.setRows("a", "b")`, `TreeMap.setLabels(...)` |

`setTargets`, `setChart1Values`, `setChart2Values`, `setRadius`, `TextView.setColumns` and the financial plurals take separate arguments; `KpiTarget`/`Sparkline.setCategories` take an array.

Singular forms (`setValue`, `setLabel`, `setRow`, ...) take exactly one field. Passing an array where separate arguments are expected (or the reverse) fails type-checking, so run `tsc`, or `npm run api -- <Class>` to see the signature. In .NET every plural setter is `params`.

## Data fields with options

```ts
const revenue = new NumberDataField("total_amount");
revenue.fieldLabel = "Revenue";                         // caption shown in the visualization
revenue.aggregationType = AggregationType.Sum;          // Sum, Avg, Min, Max, CountRows, CountDistinct, ...
revenue.sorting = SortingType.Desc;
revenue.formatting = new NumberFormatting();
revenue.formatting.formatType = NumberFormattingType.Currency;
revenue.formatting.currencySymbol = "$";
revenue.formatting.decimalDigits = 0;

const month = new DateDataField("order_date");
month.aggregationType = DateAggregationType.Month;      // Year, Quarter, Month, Day, Hour, Minute
```

Declare a field used as a **value** as a `NumberField` on the item (or use a count aggregation). A field used with `setDate` must be a `DateField`: with a `TextField`, a KPI renders the all-time total and "+0%" without any error. A calculated field is a `NumberDataField` with `isCalculated = true` and an `expression` written in Reveal's formula syntax.

## Settings, size and layout

- `configureSettings(s => { ... })` sets the type-specific options: axis titles, legends, gauge bands, map zoom, grid paging and so on. The options are in the class's `*Settings` `.d.ts`. Settings names follow the `.d.ts`, casing included (`OthersSliceThreshold`, clamped to 0-4; `StartColorIndex` on TreeMap; `NumericFieldAlignment`). Some settings are stored in the data spec (KPI periods, `Sparkline.numberOfPeriods`, `Pivot.showGrandTotals`, which defaults to `false`). In .NET the settings types are in `Reveal.Sdk.Dom.Visualizations.Settings`.
- `setPosition(rowSpan, columnSpan)` sizes a visualization on a grid **60 units wide**: 60 = full width, 30 = half, 20 = a third, 15 = a quarter. Editor dashboards use row spans around 20-30. With `doc.useAutoLayout = true` (the default) Reveal ignores spans and arranges visualizations in list order; set it to `false` to use them.
- `isTitleVisible`, `description` and `backgroundColor` are plain properties.
- `doc.theme` takes a `Theme` value: `Mountain` (default), `Aurora`, `Indigo`, `Ocean`, `Circus`, `RockyMountain`, `TropicalIsland`. The app's client-side theme (`reveal-embed` client.md) still applies on top.

## Filters

Dashboard filters live on the document, and a visualization reacts only after it's **connected**:

```ts
const region = new DashboardDataFilter("region", orders);     // field, item (or field, title, item)
region.selectValues("EMEA", "APAC");                          // optional initial selection
const period = new DashboardDateFilter("Order date");
period.ruleType = DateRuleType.AllTime;                       // default: LastYear ("last 365 days")
doc.filters = [period, region];

chart.connectDashboardFilter(period, "order_date");           // always name the date field
chart.connectDashboardFilter(region);                         // a data filter binds its own field
```

The TypeScript library writes every date filter binding against the legacy id `_date`, so stick to **one date filter per dashboard** there. The .NET library gives each date filter its own id and supports several.

**Always pass the field name when connecting a date filter.** Without one, both libraries bind to a field literally called `"Date"`. So `connectDashboardFilters(period, region)` binds the date filter to `"Date"`, and Reveal 2.2.1 then ignores **all** dashboard filters on that visualization, including the correctly bound `region`, without any error (both libraries). Connect each filter on its own and name the date field. The validation guard in typescript.md and dotnet.md catches this.

**Custom date ranges are UTC dates.** `period.ruleType = DateRuleType.CustomRange; period.customDateRange = new DateRange(new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 5, 30)));`. A local `new Date(2026, 0, 1)` is written as the previous day east of UTC, and Reveal filters (and labels) from that day. In .NET pass an unspecified or UTC `DateTime`, not `DateTime.Today`.

Visualization-level filters restrict one visualization only. They filter the **source rows** before aggregation:

```ts
const bigOrders = new NumberFilter();
bigOrders.filterType = FilterType.FilterByRule;
bigOrders.ruleType = NumberRuleType.TopItems;
bigOrders.value = 10;
chart.addDataFilter("total_amount", bigOrders);              // the 10 largest orders, then grouped by the label
```

That is **not** "top 10 regions by revenue": on a chart of revenue by product, `TopItems` 3 on the revenue field showed one bar (the 3 largest orders), and the same rule on the product field had no effect. 0.3.0 has no public API for top N categories by an aggregated value ([#69](https://github.com/RevealBi/revealbi-dom/issues/69), [.NET #441](https://github.com/RevealBi/Reveal.Sdk.Dom/issues/441)), so treat that request as a DOM gap (SKILL.md, "Use only the DOM"): don't ship a chart that isn't the top N, and **don't pick a workaround yourself: stop and ask** (SKILL.md, step 3). These are the options to put to the user, not a recipe to apply: (1) all categories sorted by the value (`revenue.sorting = SortingType.Desc` on a column chart; on a horizontal **bar** chart `Desc` puts the largest bar at the bottom, so use `Asc` to put it on top): live, follows every filter, but shows all categories; (2) a fixed `selectValues(...)` list computed while generating, from the full data the dashboard will show: exactly N bars, but it's a global top N, so it is wrong as soon as the user filters (another region, another period) and stale as data changes, and the list appears as a filter the user can edit; (3) building the chart in the Reveal editor.

`TextFilter`, `DateTimeFilter` and `TimeFilter` work the same way. In .NET, date filters take a `DateFilterRule` (dotnet.md).

## Linking

```ts
chart.linker = new VisualizationLinker()
  .addUrl("Open order", "https://app.example.com/orders/[id]")    // [field] is replaced with the clicked value
  .addDashboard("Region detail", "RegionDetail", [new LinkFilter("Region", targetFilter.id, "region")]);
```

`LinkFilter(name, targetFilterId, value)`: `targetFilter` comes from the target dashboard (`(await RdashDocument.load("RegionDetail")).filters`), so the link carries that dashboard's filter id, and `value` is the **source** column whose clicked value is passed (`"region"` here), not the target filter's title. The library's own sample passes `targetFilter.title`, which only works when the title happens to equal the source column ([#71](https://github.com/RevealBi/revealbi-dom/issues/71)). **A wrong link fails silently**: the target opens unfiltered, with no error from Reveal, and `check` passes. The guard checks that each `LinkFilter` value is a source column, and `npm run inspect` prints links; click through once in the app. `RdashDocument.load(id)` needs the browser SDK; in Node, read the target's filter ids with `loadFromBuffer` or `npm run inspect`. Linked dashboard ids go through the server's dashboard provider like any other load, so the user must be authorized for them too.
