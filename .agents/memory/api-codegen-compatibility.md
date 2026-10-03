---
name: API codegen compatibility
description: Explicitly align Orval Zod output with the workspace Zod major version.
---

Do not assume Orval's default Zod output matches the installed workspace Zod major version.

**Why:** Adding formatted UUID schemas produced zod.uuid() output although the workspace uses Zod 3, breaking the shared-library type check. Simple pattern constraints avoid that mismatch; an explicit generator version is another option when more formatted schemas are needed.

**How to apply:** When extending the API specification, check generated formatted validators against the actual installed Zod version and verify shared-library types before consuming them.