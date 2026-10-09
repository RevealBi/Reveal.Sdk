# Visualizations, fields and filters

Names below are the TypeScript ones. In .NET the same classes and methods are PascalCase (`setLabel` → `SetLabel`). Every visualization takes `(title, dataSourceItem)` (`TextBox` takes only a title), and every setter returns the visualization so calls chain.

## Which setters each visualization needs

A setter takes a field name string or a typed data field (`NumberDataField`, `DateDataField`, `TextDataField`) when the binding needs options. Where a binding takes several fields there is a plural form (`setValue` / `setValues`, `setLabel` / `setLabels`), and the plural is what adds more than one.

| Visualization classes | Bind with |
| --- | --- |
| `ColumnChart`, `BarChart`, `LineChart`, `AreaChart`, `SplineChart`, `SplineAreaChart`, `StepLineChart`, `StepAreaChart`, `StackedColumnChart`, `StackedBarChart`, `StackedAreaChart`, `Radial` | `setLabel` (category axis), `setValues`, optional `setCategory` (series split), `addFixedLine` |
| `PieChart`, `DoughnutChart`, `FunnelChart` | `setLabel`, `setValue` |
| `ComboChart` | `setLabel`, `setChart1Values`, `setChart2Values`; the series types in `configureSettings(s => { s.chart1Type = ComboChartType.Column; s.chart2Type = ComboChartType.Line; })` |
| `Scatter`, `Bubble` | `setLabel`, `setXAxis`, `setYAxis`, plus `setRadius` (bubble) |
| `KpiTime` | `setDate`, `setValue`, optional `setCategories([...])` |
| `KpiTarget` | `setDate`, `setValue`, `setTarget` |
| `Sparkline` | `setDate`, `setValue`, optional `setCategory` |
| `TimeSeries` | **Never renders in 0.3.0** (crashes the Reveal client or stays on its spinner, [#65](https://github.com/RevealBi/revealbi-dom/issues/65); SKILL.md, "Use only the DOM"). Offer a `LineChart` with `setLabel(dateDataField)` instead |
| `CircularGauge`, `Text` (single value) | `setLabel`, `setValue` |
| `LinearGauge`, `BulletGraph` | `setLabel`, `setValue`, plus `setTarget` (bullet) |
| `Grid`, `TextView` | `setColumns("a", "b", ...)` |
| `Pivot` | `setRows([...])`, `setColumns([...])`, `setValues(...)` |
| `TreeMap` | `setLabels(...)`, `setValue` |
| `Choropleth` | `setMap(...)`, `setLocation`, `setValue` |
| `ScatterMap` | `setMap(...)`, `setLatitude`, `setLongitude`, `setLabel`, optional `setColorByValue` / `setColorByCategory` |
| `CandleStick`, `OHLC` | `setLabel`, `setOpen`, `setHigh`, `setLow`, `setClose`. TypeScript can't load a dashboard that contains a Candlestick, even its own ([#67](https://github.com/RevealBi/revealbi-dom/issues/67)); prefer `OHLC` there |
| `TextBox` | `new TextBoxVisualization(title)` (no data source item), then `setText`, `setFontSize`, `setAlignment` |
| `Image` | `setUrl(field)`: binds a **column** that holds image URLs, so it needs a data source item |
| `Custom` | `setUrl` (the custom visualization page), `setRows`, `setColumns`, `setValues` |

Each class is `<Name>Visualization` (`ColumnChartVisualization`, `KpiTimeVisualization`, ...).

**Array or rest parameters vary.** In the TypeScript library:

| Takes an **array** | Takes **one or more separate arguments** |
| --- | --- |
| `Pivot.setRows([...])`, `Pivot.setColumns([...])`, `Custom.setColumns([...])`, `setCategories([...])`, `setXAxes([...])`, `setYAxes([...])` | `setValues("a", "b")`, `setLabels("a", "b")`, `Grid.setColumns("a", "b")`, `Custom.setRows("a", "b")`, `TreeMap.setLabels(...)` |

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

- `configureSettings(s => { ... })` sets the type-specific options: axis titles, legends, gauge bands, map zoom, grid paging and so on. The options are in the class's `*Settings` `.d.ts`.
- `setPosition(rowSpan, columnSpan)` sizes a visualization. With `doc.useAutoLayout = true` (the default), Reveal arranges visualizations itself in list order. Set it to `false` when you want spans to control the layout.
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

**Always pass the field name when connecting a date filter.** Without one, both libraries bind to a field literally called `"Date"`. So `connectDashboardFilters(period, region)` silently does nothing for the date filter on any item whose date column has another name. The validation guard in typescript.md and dotnet.md catches this.

Visualization-level filters restrict one visualization only. They filter the **source rows** before aggregation:

```ts
const bigOrders = new NumberFilter();
bigOrders.filterType = FilterType.FilterByRule;
bigOrders.ruleType = NumberRuleType.TopItems;
bigOrders.value = 10;
chart.addDataFilter("total_amount", bigOrders);              // the 10 largest orders, then grouped by the label
```

That is **not** "top 10 regions by revenue": on a chart of revenue by product, `TopItems` 3 on the revenue field showed one bar (the 3 largest orders), and the same rule on the product field had no effect. 0.3.0 has no public API for top N categories by an aggregated value ([#69](https://github.com/RevealBi/revealbi-dom/issues/69), [.NET #441](https://github.com/RevealBi/Reveal.Sdk.Dom/issues/441)), so treat that request as a DOM gap (SKILL.md, "Use only the DOM"): don't ship a chart that isn't the top N, and **don't pick a workaround yourself: stop and ask** (SKILL.md, step 3). These are the options to put to the user, not a recipe to apply: all categories sorted by the value (`revenue.sorting = SortingType.Desc`), a fixed `selectValues(...)` list computed while generating (it goes stale as data changes, and must be computed from the full data the dashboard will show, not a sample), or building the chart in the Reveal editor.

`TextFilter`, `DateTimeFilter` and `TimeFilter` work the same way. In .NET, date filters take a `DateFilterRule` (dotnet.md).

## Linking

```ts
chart.linker = new VisualizationLinker()
  .addUrl("Open order", "https://app.example.com/orders/[id]")    // [field] is replaced with the clicked value
  .addDashboard("Region detail", "RegionDetail", [new LinkFilter("Region", targetFilter.id, "region")]);
```

`LinkFilter(name, targetFilterId, value)`: `targetFilter` comes from the target dashboard (`(await RdashDocument.load("RegionDetail")).filters`), so the link carries that dashboard's filter id, and `value` is the **source** column whose clicked value is passed (`"region"` here), not the target filter's title. The library's own sample passes `targetFilter.title`, which only works when the title happens to equal the source column ([#71](https://github.com/RevealBi/revealbi-dom/issues/71)). Linked dashboard ids go through the server's dashboard provider like any other load, so the user must be authorized for them too.
