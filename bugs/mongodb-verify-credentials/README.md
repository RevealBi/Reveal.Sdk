# MongoDB Connection Verification Fails - Missing userContext in Second Auth Call

**Issue**: [#617](https://github.com/RevealBi/Reveal.Sdk/issues/617) (MongoDB Connection Verification Fails Due to Missing userContext in Second Authentication Call)  
**SDK Version Affected**: ≤ 1.8.4  
**Platform**: Node.js  

## Root Cause Analysis

During MongoDB `verifyCredentials`, the authentication provider is called **twice**. The second call receives `null` for `userContext`, causing credential resolution to fail when credentials are user/product-specific.

### How it happens

The Node.js SDK (`reveal-sdk-node`) forwards requests from the client to the internal .NET engine. For each such forwarded request, a random `requestId` (UUID) is generated and stored alongside the `userContext` in an in-memory map (`userContexts`):

```javascript
// In httpRequestToEngineEndpoint (reveal.js)
var requestId = randomUUID();
this.userContexts[requestId] = userContext;      // stored with user's context
var headers = {"RevealBI-RequestId": requestId};
// ...
Object.assign(headers, endpointHeaders);         // ← also copies incoming revealbi-requestid
```

When the engine needs to call Node.js back (e.g., to invoke the `authenticationProvider`), it sends a callback request that includes `revealbi-requestid` so Node.js can look up the correct `userContext`:

```javascript
// In launchCallbackServer (reveal.js)
var requestId = req.headers["revealbi-requestid"];
var userContext = this.userContexts[requestId];   // look up user context
```

**MongoDB verification requires a second phase**: after obtaining credentials the first time, the engine performs an actual connection test. This test triggers an **internal sub-request** to the main Node.js server. This sub-request:

- Comes from the engine itself (no user auth headers such as cookies or bearer tokens)
- But **does include** `revealbi-requestid` pointing to the original request's UUID

When this internal sub-request reaches `doProcess`, the current code calls `userContextProvider(req)`, which returns `null` because there are no user-identifying headers. A **new** UUID is then assigned with `userContexts[newUUID] = null`. The engine uses this new UUID for the second auth callback, which now finds `null` as the userContext.

**SQL Server** verification does not perform this second phase and therefore is not affected.

## The Fix (for `reveal-sdk-node`)

The fix is in the `doProcess` function in `lib/reveal.js`. When `userContextProvider` returns `null`, we check whether the incoming request already carries a `revealbi-requestid` that maps to an existing, active `userContext`. If so, we propagate it — ensuring that engine-initiated sub-requests inherit the correct user context from the parent request.

### Patch for `lib/reveal.js`

```diff
 doProcess: function(req, res) {
     this.addReqErrorHandler(req, res, "Request processing failed");
     this.addResErrorHandler(res, "Response processing failed");
     var parsedUrl = url.parse(req.url);
     if (this.options.basePath) {
         parsedUrl.path = parsedUrl.path.substring(1 + this.options.basePath.length);
     }

     if (parsedUrl.path == '/tools/renderhtml/') {
         this.processRenderHtml(req, res);
         return;
     }

     req.pause();
     var userContext = this.options.userContextProvider?.(req);
+    // If userContextProvider returns null, check whether this is an internal engine
+    // sub-request (e.g., during MongoDB verification) that carries the parent requestId.
+    // In that case, propagate the parent's userContext so auth callbacks succeed.
+    if (userContext == null) {
+        var parentRequestId = req.headers["revealbi-requestid"];
+        if (parentRequestId != null) {
+            userContext = this.userContexts[parentRequestId] ?? null;
+        }
+    }
     var connector = this.httpRequestToEngineEndpoint(
         req.method,
         parsedUrl.path,
         parsedUrl.query,
         req.headers,
         userContext,
```

Additionally, the following change in `httpRequestToEngineEndpoint` prevents a duplicate `revealbi-requestid` from being forwarded to the engine (which could cause the engine to receive two conflicting values for this case-insensitive header):

```diff
 httpRequestToEngineEndpoint: function(endpointMethod, endpointPath, endpointQuery, endpointHeaders, userContext, callback, errorCallback) {
     var requestId = randomUUID();
     this.userContexts[requestId] = userContext;
-    var headers = {"RevealBI-RequestId": requestId};
-    if (userContext?.userId != null) {
-        headers["RevealBI-UserId"] = userContext.userId;
-    }
-    Object.assign(headers, endpointHeaders);
+    var headers = {};
+    Object.assign(headers, endpointHeaders);
+    // Remove any incoming revealbi-requestid to prevent duplicate headers being
+    // sent to the engine (HTTP headers are case-insensitive; duplicates can cause
+    // the engine to receive an unexpected joined value like "UUID_new, UUID_old").
+    delete headers["revealbi-requestid"];
+    headers["RevealBI-RequestId"] = requestId;
+    if (userContext?.userId != null) {
+        headers["RevealBI-UserId"] = userContext.userId;
+    }
     var connector = http.request({
```

## Temporary Workaround (user-side)

Until the SDK is patched, you can work around the issue by caching the resolved credentials per user and falling back to the cache when `userContext` is `null`:

```javascript
const reveal = require('reveal-sdk-node');

// Cache credentials keyed by userId so the second (null-context) call can fall back.
const credentialCache = new Map();

const app = reveal({
    userContextProvider: (req) => {
        const userId = req.headers['x-user-id'];
        const productKey = req.headers['x-product-key'];
        if (!userId) return null;
        return { userId, productKey };
    },

    authenticationProvider: async (userContext, dataSource) => {
        if (dataSource instanceof reveal.RVMongoDBDataSource) {
            if (userContext) {
                // First call – resolve and cache credentials.
                const creds = await resolveCredentials(userContext.productKey);
                credentialCache.set(userContext.userId, creds);
                return creds;
            } else {
                // Second call during MongoDB verification – userContext is null due to SDK bug.
                // This is a temporary workaround; ideally userContext should never be null here.
                // Return the most recently cached credential.
                // NOTE: This workaround is only safe in a single-user or low-concurrency scenario.
                const cached = [...credentialCache.values()].pop();
                return cached ?? null;
            }
        }
        return null;
    }
});

async function resolveCredentials(productKey) {
    // Replace with your actual credential lookup logic
    return new reveal.RVUsernamePasswordDataSourceCredential('user', 'password');
}
```

> **⚠️ Note**: The workaround above using `credentialCache` is not safe for multi-user/high-concurrency environments because there is no reliable way to identify which user the second (null-context) call belongs to. The proper fix must be applied in the SDK itself.
