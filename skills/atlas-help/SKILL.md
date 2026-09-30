---
name: atlas-help
description: Explain Atlas Memory plugin setup, modes, commands, tools, privacy behavior, limitations, and troubleshooting.
---

# Atlas Memory help

Explain the four modes (`off`, `lite`, `full`, `ultra`), plain-prompt `atlas` commands, required `ATLAS_API_KEY`, and optional environment settings from `.env.example`. Codex rejects `/atlas` as an unrecognized slash command before the prompt hook runs; tell users to send `atlas status`, `atlas full`, or `atlas writeback on` without a leading slash. `/hooks` and `/mcp` are genuine Codex slash commands.

Explain session scope precisely: lifecycle hooks derive one stable Atlas working-memory session per project root by default. `ATLAS_CONTEXT_SESSION_ID` overrides it so multiple checkouts, machines, or hosts can deliberately share the same working-memory lane. The original Codex thread ID remains local control/provenance metadata. Working memory is temporary; episodic and semantic storage provide durable cross-session continuity.

Explain session selection through normal prompts: `atlas session status` shows and makes the current ID copyable; `atlas session new` generates and saves a fresh shared ID; `atlas session use <id>` selects a pasted ID; `atlas session list` shows locally saved IDs, not remote Atlas sessions; `atlas session project` restores the project-derived fallback. A selected ID persists across Codex project folders and is the bundled MCP server's default for retrieval and ingestion. An environment-provided `ATLAS_CONTEXT_SESSION_ID` takes precedence, so new/use/project require it to be unset and Codex restarted. Selection does not copy memories or prove that a pasted ID already exists in Atlas. When no shared ID is selected, explicit MCP calls need the project ID from the hook if they should use that working-memory lane.

Be precise about support: Codex hooks, portable manifests, skills, and MCP are implemented. Do not claim support for another host until its adapter passes live conformance tests. Automatic hydration is retrieval-only. Lifecycle writeback is separately opt-in with `atlas writeback on`, disabled by default, and saves only secret-redacted summaries of detected durable decisions and completed changes at eligible turn, compaction, and session-end boundaries. Explain `atlas writeback off`, `atlas writeback status`, and `atlas writeback default on|off`; the hook displays the exact submitted summary when it stores one.

For failures, check Node 18+, hook trust, environment inheritance, `ATLAS_BASE_URL`, `atlas_health`, and API-key access without printing the key.
