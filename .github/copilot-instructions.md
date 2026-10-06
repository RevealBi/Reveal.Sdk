# Review guidance for this repository

## skills/reveal-embed

- `skills/reveal-embed/assets/aspnet-minimal` and `assets/node-minimal` are starter projects an AI skill adapts into a customer's app. They are meant to run locally in minutes, including creating and saving dashboards in the editor.
- Their security model is intentional and documented in `skills/reveal-embed/SKILL.md`: authentication fails closed (anonymous access only with `--anonymous-demo`, bound to localhost), dashboard ids are allow-listed, shared dashboards are read-only, and saves go to a per-user folder keyed by a hash of the user id.
- Roles, tenants, dashboard sharing between users, rate limiting and the app's real authentication scheme are out of scope for the starters. Flag them only where code claims to provide them and does not.
- Files under `skills/reveal-embed/references` are reference snippets, not complete applications. Placeholders such as `userIdFrom(request)`, `TenantOf(userContext)` or `_store` stand for the customer's own code.
- Before reporting an SDK API as wrong (constructor overloads, export shapes, option names), note the evidence. The snippets target Reveal SDK 2.2.x and several were compiled or type-checked against it.
