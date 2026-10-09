# Review guidance for this repository

## skills/reveal-embed

- `skills/reveal-embed/assets/aspnet-minimal` and `assets/node-minimal` are starter projects an AI skill adapts into a customer's app. They are meant to run locally in minutes, including creating and saving dashboards in the editor.
- Their security model is intentional and documented in `skills/reveal-embed/SKILL.md`: authentication fails closed (anonymous access only with `--anonymous-demo`, bound to localhost), dashboard ids are allow-listed, shared dashboards are read-only, and saves go to a per-user folder keyed by a hash of the user id.
- Roles, tenants, dashboard sharing between users, rate limiting and the app's real authentication scheme are out of scope for the starters. Flag them only where code claims to provide them and does not.
- Files under `skills/reveal-embed/references` are reference snippets, not complete applications. Placeholders such as `userIdFrom(request)`, `TenantOf(userContext)` or `_store` stand for the customer's own code.
- Before reporting an SDK API as wrong (constructor overloads, export shapes, option names), note the evidence. The snippets target Reveal SDK 2.2.x and several were compiled or type-checked against it.

## skills/reveal-dashboard-authoring

- Targets the latest `@revealbi/dom` (npm) and `Reveal.Sdk.Dom` (NuGet prerelease) and deliberately pins no version. Both are pre-1.0, so the skill tells agents to follow the installed package's types when an example disagrees.
- The TypeScript and .NET APIs differ on purpose in a few places (date filters: `ruleType` vs `DateFilterRule`; arrays vs `params`). Don't report a difference between the two reference files as an error without checking the respective library.
- The documented behaviors (unvalidated field names, the `"Date"` default for date filter bindings, the `_date` id in TypeScript, empty `fields` on loaded items, round-trip losses, the TypeScript Candlestick load failure, `NodeNext` resolution failing) were observed by running the libraries, not inferred from the source. `npm test` in `assets/dom-ts` and `dotnet run -- test` in `assets/dom-dotnet` assert them; run those before reporting one as wrong.
- `assets/preview` is a local-only, anonymous, read-only Reveal server bound to 127.0.0.1 for rendering generated dashboards. That is intentional; flag it only if it stops binding to localhost or starts accepting saves.
