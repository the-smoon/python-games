---
name: Drive upload browser checks
description: A Chrome response-body limitation encountered during real owner-upload verification.
---

Verify an owner upload by its HTTP status plus a fresh library request, not solely by reading the intercepted browser response body.

**Why:** Real Drive upload verification twice encountered Chrome's `Network.getResponseBody` failure after a successful upload response. The file was persisted and the app refreshed normally; the test failed before recording the newly created file ID for cleanup.

**How to apply:** Locate the exact uniquely named test file through a fresh library request, record its ID, confirm the UI update, and clean up only IDs created by the test. Put timeouts on cleanup and avoid mistaking response-inspection failures for application failures.