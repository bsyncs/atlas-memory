---
name: atlas-memory
description: Save, search, and inspect persistent Atlas memory when the user explicitly asks to remember information or retrieve prior project knowledge.
---

# Atlas memory operations

For recall, first use relevant `ATLAS MEMORY CONTEXT` already supplied by a lifecycle hook. Do not repeat the same query through MCP merely because the user asked about past work. Call `atlas_retrieve` with a narrow query and the relevant persona/session when hook context is missing, insufficient, or a more focused lookup is needed. For verified graph structure, use the schema, semantic visualization, or bounded read-only Cypher tools.
Use Atlas context before searching local files for prior-session decisions. If Atlas retrieval fails, disclose the failure and label any file-based findings separately.

For writes:

1. Confirm the user explicitly intends persistence.
2. Remove secrets, credentials, unnecessary personal information, and irrelevant source text.
3. Prefer a concise decision/fact summary over an entire prompt or file.
4. Include useful metadata such as repository, component, kind, source path, and date when known.
5. Save one concise memory at a time through `atlas_ingest` so each write has a clear receipt and failure boundary.
6. Report what was stored without echoing sensitive content.

Never infer permission to ingest from a request to retrieve or hydrate context.
