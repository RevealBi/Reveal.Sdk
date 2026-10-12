# Client: RevealView in the customer's front end

Package: `reveal-sdk` on npm. No jQuery, Day.js or Spectrum script tags are needed with the current package. Sources: https://help.revealbi.io/web/install-client-sdk/, the `getting-started-*` topics, and the JavaScript API reference (https://help.revealbi.io/api/javascript/latest/).

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

- Call `setBaseUrl`, the headers provider and other global settings once at app startup (e.g. `main.ts`), before any request, not per component. Include any mount prefix (`/reveal-api/`). For cookie auth across origins, set `RevealSdkSettings.requestWithCredentialsFlag = true`.
- **The host element must have a height.** A `div` with no height renders nothing and raises no error. In framework templates the root element often has only `min-height` (Vite's React `#root` and Vue `#app`), so `height: 100%` resolves to 0: size `html, body, #root` (or `#app`) with `height: 100%`, or give the host a fixed height. If the view is blank, check `element.getBoundingClientRect().height`.
- Handle a rejected `loadDashboard` (401, 404, CORS): otherwise the area stays blank with only an unhandled rejection in the console.
- `RevealView` has no `dispose()` in 2.2.1; there is nothing to call on unmount.
- Settings that are global (`RevealSdkSettings.theme`, `betaFeatures`, `maxCellsRestriction`, headers provider) must be set **before** the `RevealView` is created (a theme can also be assigned later; see Theming).
- Set `RevealView` properties and event handlers before assigning `dashboard` where possible (exception: `canAddDashboardFilter`/`canAddDateFilter`, see Controlling the UI).

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

Give the component `:host { display: block; height: ... }` and the element `height: 100%`.

- **Production build fails on the default budget.** `reveal-sdk` is about 14.5 MB raw, so `ng build` stops with `bundle initial exceeded maximum budget` (1 MB default). Lazy-load the dashboard route (`loadComponent: () => import('./reveal-dashboard').then(m => m.RevealDashboard)`; initial bundle 229 kB, verified Angular 20.3), or raise the `initial` budget in `angular.json`.
- New CLI projects (15+) have no `environments/` folder: run `ng generate environments` or read the URL from your own config.
- Angular CLI 21 requires Node 22.22.3+ or 24.15.0+; on older Node, `ng new` refuses to run (use `@angular/cli@20` or upgrade Node).
- If Chrome or Edge DevTools freeze on the dev server: the prebundled `reveal-sdk` source map is over 30 MB. Set `"cli": { "cache": { "path": "node_modules/.cache/angular" } }` in `angular.json`; the map then loads from a `/node_modules/` URL, which DevTools ignore-list by default (path move verified on CLI 20; the freeze itself was not reproduced).

## React

Create the view in `useEffect`, guarded so StrictMode's double invocation does not create two views:

```tsx
const ref = useRef<HTMLDivElement>(null);
const initialized = useRef(false);
const [error, setError] = useState<string>();

useEffect(() => {
    if (!ref.current || initialized.current) return;
    initialized.current = true;
    RevealSdkSettings.setBaseUrl(import.meta.env.VITE_REVEAL_SERVER_URL);
    RVDashboard.loadDashboard("Sales").then(d => {
        if (!ref.current) return;
        const view = new RevealView(ref.current);
        view.dashboard = d;
    }, err => setError(String(err?.message ?? err)));   // 401, 404, CORS: show it, the view stays blank otherwise
}, []);

// Needs a real height: in the Vite template #root has only min-height, so size html, body, #root too.
return <div ref={ref} style={{ height: "100%" }} />;
```

Keep the guard: without it StrictMode creates two views on the element and loads the dashboard and every widget twice (verified React 18.3 and 19.2). The effect needs no cleanup (`RevealView` has no `dispose()`).

Use Vite for new apps. Create React App 5 production builds can stall on the Reveal ESM bundle; the workaround (Webpack external `"reveal-sdk": "Reveal"` plus the IIFE bundle in `public/`) is in the docs' Known Issues.

## Vue and others

There is no dedicated guide. Same pattern: create the view after the element is mounted, never during render, one instance per element. Vue 3 (verified 3.5, Vite):

```vue
<script setup lang="ts">
import { onMounted, useTemplateRef } from "vue";
import { RevealView, RVDashboard } from "reveal-sdk";
const host = useTemplateRef<HTMLDivElement>("host");
let view: RevealView | undefined;            // plain variable: no reactive proxy needed
onMounted(async () => {
    const dashboard = await RVDashboard.loadDashboard("Sales");   // setBaseUrl once in main.ts
    view = new RevealView(host.value!);
    view.dashboard = dashboard;
});
</script>
<template><div ref="host" style="height: 100%"></div></template>
```

- Size `html, body, #app` (the Vite template gives `#app` only a `min-height`).
- Keeping the view in `ref()` also works, but there is no reason to proxy it; use a plain variable or `shallowRef`.
- `onBeforeUnmount` has nothing to call (no `dispose()`).

## Web component wrappers (pre-1.0, community-driven)

`reveal-sdk-wrappers` (0.3.0, RevealBi/reveal-sdk-wrappers) wraps `RevealView` as `<rv-reveal-view>` and `<rv-visualization-viewer>`. `reveal-sdk` is a peer dependency and must be installed too. React and Angular bindings: `reveal-sdk-wrappers-react`, `reveal-sdk-wrappers-angular`. The npm package has no README; the package typings are the reference.

```html
<rv-reveal-view id="sales" dashboard="Sales"></rv-reveal-view>          <!-- dashboard id, or set .dashboard to an RVDashboard -->
<rv-visualization-viewer dashboard="Sales" visualization="Revenue"></rv-visualization-viewer>  <!-- title, id or index -->
<script type="module">
  import { RevealSdkSettings } from "reveal-sdk";
  import { defineRevealSdkWrappers } from "reveal-sdk-wrappers";
  RevealSdkSettings.setBaseUrl("https://reveal-server.example.com/");   // settings stay on RevealSdkSettings
  defineRevealSdkWrappers();
  const el = document.getElementById("sales");
  el.options = { canEdit: false, header: { menu: { exportToExcel: false } } };   // object property, not an attribute
  el.saving = args => { /* same args as onSave */ };
</script>
```

- Verified with 0.3.0 and reveal-sdk 2.2.1. Suggest them when the customer prefers declarative markup.
- The view renders in **shadow DOM**: page CSS does not reach it (loaded `@font-face` fonts do), and light-DOM `innerText` is empty, which breaks naive text checks in tests.
- The wrapped `RevealView` is private. Public methods include `enterEditMode`, `exportToPdf`, `refreshData`, `getFilters`, `getRVDashboard`. When you need a `RevealView` property that `options` lacks, use `RevealView` directly.
- The wrapper listens for a `reveal-theme-changed` event that reveal-sdk 2.2.1 never fires; harmless, because assigning the theme re-renders views anyway (see Theming). A `Multiple versions of Lit loaded` console warning is expected.

## Controlling the UI

Common `RevealView` properties (full list: docs topic `editing-dashboards`):

| Goal | Property |
| --- | --- |
| Read-only dashboards | `canEdit = false` |
| No Save As | `canSaveAs = false` |
| Open straight into the editor | `startInEditMode = true` |
| Hide export options | `showExportToPDF`, `showExportToExcel`, `showExportToPowerPoint`, `showExportImage`, `showExportToCsv` (exact casing: in JS a misspelled property silently does nothing) |
| Hide chrome | `showHeader`, `showMenu`, `showFilters`, `showRefresh` |
| Restrict editing features | `canAddVisualization`, `canAddCalculatedFields`, `canAddDashboardFilter`, `showChangeDataSource`, `showEditDataSource` |
| Tooltips | `showTooltips` |

Exception to "properties before `dashboard`": setting `canAddDashboardFilter` or `canAddDateFilter` before a dashboard is assigned can fail with `_globalFiltersGrid` is null; set them after `revealView.dashboard = ...`.

Events for integrating with the host app: `onDataSourcesRequested` (data sources offered in the editor), `onSave`, `onVisualizationEditorOpening/Opened/Closing/Closed`, click events (`onVisualizationDataPointClicked`), custom menu items, and linking/navigation. Dashboard filters can be read and set from code: `revealView.dashboard.filters.getByTitle("Region").selectedValues = ["Europe"]`. See docs topics `click-events`, `custom-menu-items`, `filtering-dashboards`, `linking-dashboards`.

## Theming

```js
const theme = RevealSdkSettings.theme;   // or new MountainLightTheme(), MountainDarkTheme(), OceanLightTheme(), OceanDarkTheme()
theme.accentColor = "#0b5cad";
theme.chartColors = ["#0b5cad", "#e07a10", "#2a9d8f"];
theme.dashboardBackgroundColor = "#ffffff";
theme.regularFont = "Inter";
RevealSdkSettings.theme = theme;         // assigning back is what applies it
```

- Read, change, then **assign back**, before creating the `RevealView`. Reading returns the live object, so a mutation shows up on the next read even though it was never applied. Mutating without assigning is not harmless: a view created afterwards loses the theme's fonts and renders in the browser's serif fallback (verified 2.2.1).
- At runtime (e.g. a dark-mode toggle), assigning `RevealSdkSettings.theme` re-renders every `RevealView` on the page by itself: each view reloads its dashboard and closes the editor if it is open. Filter selections set through the API and an in-memory title change survived in 2.2.1 (not checked: selections made in the filter UI, unapplied editor changes, a maximized visualization). Avoid toggling the theme while the user is editing.
- `refreshTheme()` is not needed after an assignment; calling it reloads the dashboard a second time. It also reloads and closes the editor when called on its own.
- The theme is global to every `RevealView` on the page.
- Font properties take a family name; the face must already be loaded by the page (`@font-face` or a font service). Bold/medium/italic slots render the named family at normal weight, so point them at families or aliases that are the bold/italic faces. Verified: a bold slot pointing at a family whose 700 face is loaded still draws regular; point it at a family whose only face is the bold file. See the docs topic `theming-fonts`.
- Other `RevealTheme` properties: `visualizationBackgroundColor`, `fontColor`, `highlightColor`, `conditionalFormatting`, `visualizationMargin`, `useRoundedCorners`.

## Localization, accessibility

The SDK ships locale files (`dist/locales/`). Docs topics: `localizing`, `accessibility`.
