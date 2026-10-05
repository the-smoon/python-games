---
name: API route test bundling
description: Test harness constraints for dependency-injected API routes and the workspace's ESM bundler.
---

API route tests should inject persistence instead of loading the live database. Bundle the local generated API validators, while externalizing Express, Drizzle, and `@workspace/db`; the injected tests never invoke the lazy database import.

**Why:** Bundling CommonJS service dependencies into the temporary ESM test output caused unsupported dynamic `require()` calls. Externalizing generated validators or workspace database sub-dependencies caused package-resolution failures.

**How to apply:** Extend the existing API test runner with dependency-injected route tests. Test actual PostgreSQL writes separately through the running API and remove any temporary rows.