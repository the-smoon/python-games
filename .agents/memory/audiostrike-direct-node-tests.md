---
name: Direct Node tests for AudioStrike
description: Node ESM import resolution for browser modules loaded directly by Node tests.
---

When an MJS test imports a TypeScript source module directly under Node's built-in TypeScript support, runtime relative imports along that module path must include the `.ts` extension. Type-only imports are erased and do not need runtime resolution.

**Why:** Vite's extensionless module resolution hid a runtime failure during Node test collection.

**How to apply:** When importing a browser-side TypeScript module from a plain Node test, check each runtime import in its dependency path and run the Node tests; the current TypeScript config permits `.ts` extensions with `noEmit`.

Node's strip-only TypeScript support does not transform constructor parameter properties.

**Why:** A module that worked under Vite could not be collected by direct Node tests because its constructor used a TypeScript parameter property.

**How to apply:** Keep directly tested browser modules compatible with strip-only TypeScript, or explicitly compile the test entrypoint. Ordinary field declarations and constructor assignment work without a transformation step.