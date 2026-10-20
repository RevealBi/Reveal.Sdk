// Minimal Express host for the Reveal SDK. All Reveal wiring is in reveal-server.cjs (the Reveal
// endpoints under /reveal-api/, default-deny providers, validated dashboard storage and the
// sample data); this file is the app around it, and the page in ./public opens the sample
// dashboard (dashboards/Sales.rdash).
//
//     npm install && npm run demo    ->  http://localhost:5111/
//
// `npm start` (node main.js) requires an authenticated user on every Reveal request and
// answers 401 until the app's real authentication is added below. `npm run demo` passes
// --anonymous-demo: anonymous access for a local first run, listening on localhost only
// (set HOST=0.0.0.0 to reach it from outside a container). It refuses to start that way
// when NODE_ENV=production.
//
// Adding Reveal to an existing app: copy reveal-server.cjs, dashboards/Sales.rdash and
// sample-data/sales.json, and call mountReveal the way this file does, before express.json()
// and the app's own routes, static files and dev middleware.
//
// Start it from this folder: ./dashboards and ./sample-data resolve against the working
// directory. License: ~/.revealbi-sdk/license.key or REVEAL_LICENSE (without either, the
// engine fails to start and the process exits seconds later).

const path = require("path");
const express = require("express");
const cors = require("cors");
const { mountReveal } = require("./reveal-server.cjs");

const anonymousDemo = process.argv.includes("--anonymous-demo");
const port = Number(process.env.PORT) || 5111;

const app = express();

// Only needed when the front end is served from another origin. Opt in by setting
// CLIENT_ORIGIN (e.g. https://app.example.com, or a comma-separated list); never allow
// every origin.
if (process.env.CLIENT_ORIGIN) {
    app.use(cors({ origin: process.env.CLIENT_ORIGIN.split(",").map((o) => o.trim()) }));
}

app.use(express.static(path.join(__dirname, "public")));

// Add the app's real authentication here (passport.authenticate(...), express-jwt) so it
// sets request.user. It must run before Reveal.
// app.use(authenticate);

// Reveal under /reveal-api/ and the sample data under /sample-data/.
mountReveal(app, { port });

if (anonymousDemo) {
    const host = process.env.HOST || "127.0.0.1";
    app.listen(port, host, () => console.log(`Anonymous demo on http://localhost:${port}/ (listening on ${host})`));
} else {
    app.listen(port, () => console.log(`Reveal server on port ${port}`));
}
