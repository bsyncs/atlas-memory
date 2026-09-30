---
name: atlas-reasoning
description: Use Atlas schema inspection, visual graph data, or bounded read-only Cypher for relational project-memory questions.
---

# Atlas graph reasoning

- Use `atlas_schema` before writing Cypher when labels or relationship types are unknown.
- Use `atlas_cypher_readonly` only for bounded inspection; include a conservative row limit.
- Use semantic or episodic visualization data when structure or clustering materially helps analysis.
- Use `atlas_retrieve` when the question can be answered from recalled facts without an exact graph query.
- Keep Cypher patterns simple; the current security guard rejects some function expressions even when the patterns are tenant scoped.
- Do not use admin tools as substitutes for ordinary retrieval.
