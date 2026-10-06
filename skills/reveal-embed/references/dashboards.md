# Loading, saving and creating dashboards

Sources: https://help.revealbi.io/web/loading-dashboards, `saving-dashboards`, `creating-dashboards`, `editing-dashboards`.

A dashboard is an `.rdash` file: a zip of JSON describing the visualizations, filters and data sources. Customers create them in the `RevealView` editor (in their own app or a dev build of it) or in the Reveal app, then ship or store them. Do not hand-write `.rdash` JSON for them.

## Default convention

| Server | Default location |
| --- | --- |
| ASP.NET | `Dashboards/` under the working directory. Load and save both work, but the default provider lets **any authenticated user read and overwrite every dashboard**. Fine for a single-user app; otherwise supply a provider that authorizes per user or tenant (assets/aspnet-minimal has one), or set `canEdit = false`. |
| Node.js | `dashboards/` under the working directory. The built-in loader/saver does not validate the id (path traversal on 2.2.1); always supply validating `dashboardProvider` and `dashboardStorageProvider` that also authorize per user or tenant. |
| Java | None. Always configure a provider. The built-in `RVDashboardProvider(path)` has the same overwrite-anything behavior; use the per-user provider in server-java.md, or a custom one. |

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
    private static readonly Regex ValidId = new("^[A-Za-z0-9_-]{1,100}$");

    public async Task<Dashboard> GetDashboardAsync(IRVUserContext userContext, string dashboardId)
    {
        if (!ValidId.IsMatch(dashboardId)) throw new ArgumentException("Invalid dashboard id.");
        var tenant = TenantOf(userContext);                       // from validated claims
        var bytes = await _store.LoadAsync(tenant, dashboardId);  // null when missing or not allowed
        if (bytes is null) throw new FileNotFoundException(dashboardId);
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
- **Validate `dashboardId`** before building a path or key from it (letters, digits, dashes; no `..`, `/` or `\`). It comes from the client.
- **Authorize saves on the server.** `canEdit` and `canSaveAs` are client UI settings; anyone holding a session can call the save endpoint directly. Check the user's right to write that dashboard in the provider (or in the app's own save API).
- Registering a custom provider replaces the default for both load **and** save. Implement both, or make save throw for everyone (and also set `canEdit = false` so the UI matches).
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
    if (args.saveAs || args.isNew) {
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
    let id = args.dashboardId;
    if (args.saveAs || args.isNew) {
        id = await askUserForName();
        if (!id || !(await confirmIfExists(id))) return; // cancelled: stay in edit mode
    }
    const serialize = args.saveAs || args.isNew
        ? cb => args.serializeWithNewName(id, cb)
        : cb => args.serialize(cb);
    serialize(async bytes => {
        try {
            const res = await fetch(`/api/dashboards/${encodeURIComponent(id)}`, { method: "PUT", body: bytes });
            if (!res.ok) throw new Error(`Save failed: ${res.status}`);
            // Point the loaded dashboard at the new id, or the next plain Save
            // overwrites the original dashboard instead of the copy.
            args.dashboardId = args.name = id;
            args.saveFinished();                        // only after the server accepted the bytes
        } catch (err) {
            showSaveError(err);                         // stay in edit mode so the changes are not lost
        }
    });
};
```

- `args.name` is the dashboard **title**. Keep the stored id and the title aligned, or the next Save writes under an unexpected id.
- After a Save As, set `args.dashboardId` (and `args.name`) to the new id before `saveFinished()` in **both** modes. With `serverSideSave = false`, `serializeWithNewName` only renames the serialized copy; the view keeps the old id until you update `args`.
- `args.isNew` is true for a dashboard created from `new RVDashboard()`. Its `dashboardId` is null until you set it, so treat its first Save like Save As.
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

A dashboard built against a dev database keeps that connection inside the `.rdash`. Do not edit the file. Redirect it at runtime in the data source provider (data-sources.md), or use the techniques in the docs topic `replacing-datasources`.
