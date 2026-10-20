// Minimal Express host for the Reveal SDK. All Reveal wiring is in reveal-server.cjs (the Reveal
// endpoints under /reveal-api/, default-deny providers, validated dashboard storage and the
// sample data); this file is the app around it, and the page in ./public shows the sample
// dashboard (dashboards/Sales.rdash), view only.
//
//     npm install && npm start    ->  http://localhost:5111/
//
// This sample has no login, so it allows anonymous viewing (allowAnonymous below) and listens
// on localhost only (HOST=0.0.0.0 to reach it from outside a container). Once the app has
// login, add it below and remove allowAnonymous: every Reveal request then needs a signed-in
// user.
//
// Adding Reveal to an existing app: copy reveal-server.cjs, dashboards/Sales.rdash and
// sample-data/sales.json, and call mountReveal the way this file does, before express.json()
// and the app's own routes, static files and dev middleware.
//
// The sample dashboard's "sales" item names a placeholder URL; reveal-server.cjs maps it to
// sample-data/sales.json, served by this app. Delete the dashboard, sample-data/ and the
// SAMPLE_DATA rule together once the app has its own data.
//
// Start it from this folder: ./dashboards and ./sample-data resolve against the working
// directory. License: ~/.revealbi-sdk/license.key or REVEAL_LICENSE (without either, the
// engine fails to start and the process exits seconds later).

const path = require("path");
const express = require("express");
const cors = require("cors");
const { mountReveal } = require("./reveal-server.cjs");

const port = Number(process.env.PORT) || 5111;
const host = process.env.HOST || "127.0.0.1";

const app = express();

// Only needed when the front end is served from another origin. Opt in by setting
// CLIENT_ORIGIN (e.g. https://app.example.com, or a comma-separated list); never allow
// every origin.
if (process.env.CLIENT_ORIGIN) {
    app.use(cors({ origin: process.env.CLIENT_ORIGIN.split(",").map((o) => o.trim()) }));
}

app.use(express.static(path.join(__dirname, "public")));

// The app's real authentication goes here (passport.authenticate(...), express-jwt), so it
// sets request.user. It must run before Reveal.
// app.use(authenticate);

// Reveal under /reveal-api/ and the sample data under /sample-data/.
mountReveal(app, { port, allowAnonymous: true });

app.listen(port, host, () => console.log(`Reveal sample on http://localhost:${port}/ (listening on ${host})`));
