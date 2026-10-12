# Loading, saving and creating dashboards

Sources: https://help.revealbi.io/web/loading-dashboards/, `saving-dashboards`, `creating-dashboards`, `editing-dashboards`.

A dashboard is an `.rdash` file: a zip of JSON describing the visualizations, filters and data sources. Customers create them in the `RevealView` editor (in their own app or a dev build of it) or in the Reveal app, then ship or store them. When dashboards must be created or changed in code, use the Reveal DOM (see [below](#creating-and-changing-dashboards-in-code)). Never hand-write or string-edit `.rdash` JSON.

## Default convention

| Server | Default location |
| --- | --- |
| ASP.NET | `Dashboards/` under the working directory. Load and save both work, but the default provider lets **any authenticated user read and overwrite every dashboard**; treat it as a demo default. Always register a provider that validates the id (letters, digits, dash, underscore) and authorizes per user or tenant (assets/aspnet-minimal has one); `canEdit = false` alone does not close the save endpoint. |
| Node.js | `dashboards/` under the working directory. Treat the built-in loader and saver as demo defaults. Always supply **both** `dashboardProvider` and `dashboardStorageProvider`, validating the id (letters, digits, dash, underscore) and authorizing per user or tenant, so loading and saving go through the same validated, authorized path. |
| Java | `~/dashboards` of the account running the server (the built-in `RVDashboardProvider()`), used whenever no provider is set. Any caller can overwrite any dashboard; treat it as a demo default. Always set a provider that validates the id (letters, digits, dash, underscore) and authorizes per user or tenant: server-java.md or assets/java-minimal. |

The client loads by id, which is the file name without `.rdash`:

```js
const dashboard = await RVDashboard.loadDashboard("Sales");
revealView.dashboard = dashboard;
```

## Custom dashboard provider

Use one when dashboards live in a database, blob storage, a per-tenant folder, or come with per-user permissions.

```cs
public class DashboardProvider : IRVDashboardProvider
{
    // \z, not $: in .NET "$" also matches before a final "\n".
    private static readonly Regex ValidId = new(@"^[A-Za-z0-9_-]{1,100}\z");

    public async Task<Dashboard?> GetDashboardAsync(IRVUserContext userContext, string dashboardId)
    {
        if (!ValidId.IsMatch(dashboardId)) return null;           // Reveal answers 404
        var tenant = TenantOf(userContext);                       // from validated claims
        var bytes = await _store.LoadAsync(tenant, dashboardId);  // null when missing or not allowed
        if (bytes is null) return null;                           // 404; throwing gives a 500
        return new Dashboard(bytes);
    }

    public async Task SaveDashboardAsync(IRVUserContext userContext, string dashboardId, Dashboard dashboard)
    {
        if (!ValidId.IsMatch(dashboardId)) throw new ArgumentException("Invalid dashboard id.");
        // canEdit = false on the client only hides the UI; the save endpoint is still callable.
        if (!CanEdit(userContext, dashboardId)) throw new UnauthorizedAccessException();
        var tenant = TenantOf(userContext);
        await _store.SaveAsync(tenant, dashboardId, dashboard.ToByteArray());
    }
}
```

- `Dashboard` (ASP.NET) can be constructed from a file path, a `Stream`, a `byte[]`, or `Dashboard.FromJsonString(json)`. It writes out with `SaveToFileAsync(path)`, `ToStream()`, `ToByteArray()` or `ToJsonString()`. `dashboard.GetInfo(id)` returns its title and other metadata, which is useful for a dashboard list.
- **Validate `dashboardId`** before building a path or key from it (1-100 letters, digits, underscores or hyphens, `[A-Za-z0-9_-]`; no `..`, `/` or `\`; in .NET anchor the regex with `\z`, not `$`). It comes from the client. For a missing or invalid id, return `null` so Reveal answers 404; an exception gives a 500, and on ASP.NET its message can reach the browser.
- **Authorize saves on the server.** `canEdit` and `canSaveAs` are client UI settings; anyone holding a session can call the save endpoint directly. Check the user's right to write that dashboard in the provider (or in the app's own save API).
- On ASP.NET and Java, registering a custom provider replaces the default for both load **and** save. Implement both, or make save throw for everyone (and also set `canEdit = false` so the UI matches). On **Node** the two are separate options: always supply `dashboardStorageProvider` together with `dashboardProvider` (one that throws if saving is not allowed), so loading and saving go through the same validated, authorized path.
- Node: `dashboardProvider: async (userContext, dashboardId) => Readable | null` for loading, plus `dashboardStorageProvider: async (userContext, dashboardId, stream) => void` for saving. Java: `getDashboard` returns an `InputStream`, `saveDashboard` receives one.

Listing dashboards (for a picker in the app) is not a Reveal endpoint. Add an app endpoint that lists the store. `RVDashboard.loadDashboard` is only for one by id. Thumbnails for a picker: docs topic `thumbnail-generation`.

## Saving

| Operation | Default behavior |
| --- | --- |
| **Save** (check button in edit mode) | Calls the server dashboard provider's save with the current id. Works out of the box with the default folder. |
| **Save As** (kebab menu) | **Not implemented by default.** The app must capture a name. |

Save As with the server provider doing the write:

```js
revealView.onSave = async (rv, args) => {
    // A new dashboard has no id yet, so a plain Save needs a name too.
    if (args.saveAs || args.dashboardId == null) {
        const name = await askUserForName();            // app UI, not prompt() in production
        if (!name || !(await confirmIfExists(name))) {
            return;                                     // cancelled: no saveFinished(), so nothing is
        }                                               // saved and the user stays in edit mode
        args.dashboardId = args.name = name;
    }
    args.saveFinished();                                // required: performs the save and leaves edit mode
};
```

Saving entirely from the client to the app's own API:

```js
revealView.serverSideSave = false;
revealView.onSave = async (rv, args) => {
    const isSaveAs = args.saveAs || args.dashboardId == null;
    let id = args.dashboardId;
    if (isSaveAs) {
        id = await askUserForName();
        if (!id || !(await confirmIfExists(id))) return; // cancelled: stay in edit mode
    }
    // Without the error callback a failed serialization throws and showSaveError never runs.
    const onError = err => showSaveError(new Error(String(err)));
    const serialize = isSaveAs
        ? cb => args.serializeWithNewName(id, cb, onError)
        : cb => args.serialize(cb, onError);
    serialize(async bytes => {
        try {
            const res = await fetch(`/api/dashboards/${encodeURIComponent(id)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/octet-stream" }, // e.g. express.raw() on that route
                body: bytes,
            });
            if (!res.ok) throw new Error(`Save failed: ${res.status}`);
            // Point the loaded dashboard at the new id, or the next plain Save
            // overwrites the original dashboard instead of the copy.
            if (isSaveAs) args.dashboardId = args.name = id; // a plain Save keeps the title
            args.saveFinished();                        // only after the server accepted the bytes
        } catch (err) {
            showSaveError(err);                         // stay in edit mode so the changes are not lost
        }
    });
};
```

- `args.name` is the dashboard **title**. Keep the stored id and the title aligned, or the next Save writes under an unexpected id.
- After a Save As, set `args.dashboardId` (and `args.name`) to the new id before `saveFinished()` in **both** modes. `serializeWithNewName` sets the title of the live dashboard and of the bytes, not the id; if `args.dashboardId` is not set, `saveFinished()` takes `args.name` (the title) as the id. Set `args.name` only when the title should change: `saveFinished()` applies it as the title.
- `args.dashboardId` is null for a dashboard created from `new RVDashboard()` and on Save As, so treat that first Save like Save As. `args.isNew` means the same but is deprecated in 2.2.1.
- Pass the error callback to `serialize` and `serializeWithNewName`. Two-argument calls work when serialization succeeds (verified 2.2.1); the callback is what reports a failure.
- The `fetch` must send a `Content-Type` your endpoint parses as raw bytes (`express.raw()` defaults to `application/octet-stream`); without one, the endpoint receives an empty body.
- `saveFinished()` must be called or the view stays in edit mode. On cancel or a failed request, deliberately do **not** call it: leaving edit mode would discard the user's unsaved changes. With `serverSideSave = false`, call it only after the app's API confirms the write.
- With `serverSideSave = false`, the app's `PUT /api/dashboards/{id}` is an ordinary app endpoint: require authentication, validate the id, and check the user may write that dashboard, exactly as in the server provider above.
- To hide saving in the UI: `canEdit = false` (no editing at all) or `canSaveAs = false` (no Save As). These are not access control; enforce it on the server as well.

## Creating new dashboards

```js
revealView.dashboard = new RVDashboard();
revealView.onDataSourcesRequested = (callback) => { /* offer data sources; see data-sources.md */ };
```

An empty dashboard with no data sources offered cannot get any visualizations. `startInEditMode = true` and `startWithNewVisualization = true` take the user straight into the editor.

## Loading from JSON or a resource

Dashboards can also be loaded from an embedded resource or from JSON (docs: `loading-dashboards`, "Load from Resource" and "Load From JSON"). Use these when dashboards ship inside the app binary.

## Replacing data sources in a shipped dashboard

A dashboard built against a dev database keeps that connection inside the `.rdash`. Redirect it at runtime in the data source provider (data-sources.md), or use the techniques in the docs topic `replacing-datasources`. The provider stays correct for dashboards users save later, and it keeps connection details out of the files. Rewrite the file itself (with the DOM, below) only for a one-off migration, such as moving shipped dashboards off a retired database.

## Creating and changing dashboards in code

The Reveal DOM is an object model for `.rdash` files: `@revealbi/dom` for TypeScript/JavaScript (browser or Node, no Reveal SDK needed) and `Reveal.Sdk.Dom` for .NET. Use it when dashboards come from code rather than the editor:

- A template filled in per tenant or per user. Build it inside the dashboard provider and return it, after the usual id validation and authorization. The template isolates only the layout: scope its data on the server from the user context (user-context-security.md); filters set in the dashboard are user-editable.
- Dashboards generated from a spec, a wizard or AI output, which then open in the editor for the user to refine.
- Bulk changes to stored dashboards: retitle, remove a visualization, copy visualizations between dashboards, or a one-off data source migration.

```js
// Node dashboard provider returning a generated dashboard
const doc = buildTenantOverview(tenantOf(userContext));          // an RdashDocument from @revealbi/dom
return Readable.from(Buffer.from(await doc.toBlob().arrayBuffer()));
```

```cs
// ASP.NET IRVDashboardProvider returning a generated dashboard (Reveal.Sdk.Dom)
return Dashboard.FromJsonString(TenantOverview.Build(TenantOf(userContext)).ToJsonString());
```

For the API, the traps (field names aren't validated, date filters connect to a field literally called `"Date"` unless you name one, and round-tripping editor-made dashboards drops a few settings), and complete tested examples, use the `reveal-dashboard-authoring` skill.
