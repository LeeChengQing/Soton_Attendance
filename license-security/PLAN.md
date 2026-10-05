# Two-project license implementation

Goal: leaked extension source cannot authorize a Global AI request without an active license bound in China; verified Stripe/ToyyibPay payments issue licenses directly in China.

The user's four modules define the implementation scope. Security correction: replace frontend table reads/writes with a China activation Edge Function and a service-only, row-locking RPC. Global checks China on every request, then reserves a license-wide request quota atomically. No live project, existing release, or phone-notification behavior is changed.

1. Write failing database, frontend and Edge boundary tests. Use real embedded PostgreSQL for SQL and doubles only for external Chrome/Supabase/OpenAI boundaries.
2. Add China schema with explicit grants, default-deny RLS, service-only activation and consumption RPCs, expiry and usage limits.
3. Add frontend factory creating named Auth and Business clients, a Web Lock around persistent device IDs, activation and proxy invocation.
4. Add China activation and Global proxy functions, shared bounded JSON/error/CORS utilities, pinned dependencies and separate deployment configs.
   Add verified Stripe/ToyyibPay Next.js-compatible POST handlers: raw-body Stripe signatures, ToyyibPay signed callbacks plus transaction lookup, known-order amount/currency checks and database-backed idempotency. Device/billing limits come from server-created orders.
5. Verify SQL behavior/permissions, Edge types and rejection paths, local extension bundling and the existing repository test suite. Document real-project validation still required.

Review focus: client credentials are public; no table access for anon/authenticated; revoked/expired/unbound licenses never reach OpenAI; malformed responses and outages fail closed; copied UUIDs remain replayable credentials; CORS is not authentication; quotas are enforced per license across devices and Edge instances.
