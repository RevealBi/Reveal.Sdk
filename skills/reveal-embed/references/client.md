# Client: RevealView in the customer's front end

Package: `reveal-sdk` on npm. No jQuery, Day.js or Spectrum script tags are needed with the current package. Sources: https://help.revealbi.io/web/install-client-sdk and the `getting-started-*` topics.

## Loading the SDK

| App type | Load it with |
| --- | --- |
| Bundler or framework (Vite, Webpack, Angular, React, Vue) | `npm install reveal-sdk`, then `import { RevealView, RevealSdkSettings, RVDashboard } from "reveal-sdk"` |
| Plain HTML with modules | `<script type="module">import { ... } from "https://cdn.jsdelivr.net/npm/reveal-sdk@<version>/dist/reveal-sdk.esm.js"</script>` |
| Plain HTML with classic scripts | `<script src="https://cdn.jsdelivr.net/npm/reveal-sdk@<version>/dist/reveal-sdk.js">`, everything on the global `Reveal` object |
| No CDN or npm allowed | Download `https://dl.revealbi.io/reveal/libs/<version>/reveal-sdk-distribution-js.zip`, serve the files from the app, keep the `locales/` folder next to `reveal-sdk.js` |

Pin the version in CDN URLs for production. Use the same version as the server package.

## The three lines that matter

```js
RevealSdkSettings.setBaseUrl("https://reveal-server.example.com/"); // only if the server is on another origin; keep the trailing slash
const dashboard = await RVDashboard.loadDashboard("Sales");          // file name without .rdash
const revealView = new RevealView(hostElement);                      // element or selector
revealView.dashboard = dashboard;
```

- Call `setBaseUrl` once, before any request. Include any mount prefix (`/reveal-api/`).
- **The host element must have a height.** A `div` with no height renders nothing and raises no error.
- Settings that are global (`RevealSdkSettings.theme`, `betaFeatures`, `maxCellsRestriction`, headers provider) must be set **before** the `RevealView` is created.
- Set `RevealView` properties and event handlers before assigning `dashboard` where possible.

## Angular

Create the view in `ngAfterViewInit`, from a `@ViewChild` element reference:

```ts
@ViewChild('revealView') revealViewElement!: ElementRef<HTMLElement>;

async ngAfterViewInit() {
    RevealSdkSettings.setBaseUrl(environment.revealServerUrl);
    const dashboard = await RVDashboard.loadDashboard("Sales");
    this.revealView = new RevealView(this.revealViewElement.nativeElement);
    this.revealView.dashboard = dashboard;
}
```

Give the component `:host { display: block; height: ... }` and the element `height: 100%`. If Chrome or Edge DevTools freeze on an Angular dev server, set `"cli": { "cache": { "path": "node_modules/.cache/angular" } }` in `angular.json` (a huge generated source map is the cause).

## React

Create the view in `useEffect`, guarded so StrictMode's double invocation does not create two views:

```tsx
const ref = useRef<HTMLDivElement>(null);
const initialized = useRef(false);

useEffect(() => {
    if (!ref.current || initialized.current) return;
    initialized.current = true;
    RevealSdkSettings.setBaseUrl(import.meta.env.VITE_REVEAL_SERVER_URL);
    RVDashboard.loadDashboard("Sales").then(d => {
        if (!ref.current) return;
        const view = new RevealView(ref.current);
        view.dashboard = d;
    });
}, []);

return <div ref={ref} style={{ height: "100%" }} />;
```

Use Vite for new apps. Create React App 5 production builds can stall on the Reveal ESM bundle; the workaround (Webpack external `"reveal-sdk": "Reveal"` plus the IIFE bundle in `public/`) is in the docs' Known Issues.

## Vue and others

There is no dedicated guide. Same pattern: import from `reveal-sdk`, create the view after the element is mounted (`onMounted` with a template ref), never during render, and keep a single instance per element.

## Web component wrappers (beta, community-driven)

`reveal-sdk-wrappers` wraps `RevealView` as `<rv-reveal-view>` and `<rv-visualization-viewer>`. `reveal-sdk` is a peer dependency and must be installed too.

```js
import { defineRevealSdkWrappers } from "reveal-sdk-wrappers";
defineRevealSdkWrappers();
```

Suggest them when the customer prefers declarative markup. Say that they are beta, and fall back to `RevealView` for anything the wrapper options do not expose.

## Controlling the UI

Common `RevealView` properties (full list: docs topic `editing-dashboards`):

| Goal | Property |
| --- | --- |
| Read-only dashboards | `canEdit = false` |
| No Save As | `canSaveAs = false` |
| Open straight into the editor | `startInEditMode = true` |
| Hide export options | `showExportToPDF`, `showExportToExcel`, `showExportToPowerPoint`, `showExportImage`, `showExportToCSV` |
| Hide chrome | `showHeader`, `showMenu`, `showFilters`, `showRefresh` |
| Restrict editing features | `canAddVisualization`, `canAddCalculatedFields`, `canAddDashboardFilter`, `showChangeDataSource`, `showEditDataSource` |
| Tooltips | `showTooltips` |

Events for integrating with the host app: `onDataSourcesRequested` (data sources offered in the editor), `onSave`, `onVisualizationEditorOpening/Opened/Closing/Closed`, click events (`onVisualizationDataPointClicked`), custom menu items, and linking/navigation. Dashboard filters can be read and set from code (`revealView.dashboard.filters`). See docs topics `click-events`, `custom-menu-items`, `filtering-dashboards`, `linking-dashboards`.

## Theming

```js
const theme = RevealSdkSettings.theme;   // or new MountainLightTheme(), MountainDarkTheme(), OceanLightTheme(), OceanDarkTheme()
theme.accentColor = "#0b5cad";
theme.chartColors = ["#0b5cad", "#e07a10", "#2a9d8f"];
theme.dashboardBackgroundColor = "#ffffff";
theme.regularFont = "Inter";
RevealSdkSettings.theme = theme;         // assigning back is what applies it
```

- Mutating the object you read from `RevealSdkSettings.theme` does nothing until you **assign it back**. Do it before creating the `RevealView`.
- To change the theme at runtime (e.g. the app's dark mode toggle), assign the new theme and call `revealView.refreshTheme()`.
- The theme is global to every `RevealView` on the page.
- Font properties take a family name; the face must already be loaded by the page (`@font-face` or a font service). Bold/medium/italic slots render the named family at normal weight, so point them at families or aliases that are the bold/italic faces. See the docs topic `theming-fonts`.
- Other `RevealTheme` properties: `visualizationBackgroundColor`, `fontColor`, `highlightColor`, `conditionalFormatting`, `visualizationMargin`, `useRoundedCorners`.

## Localization, accessibility

The SDK ships locale files (`dist/locales/`). Docs topics: `localizing`, `accessibility`.
