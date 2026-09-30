---
name: atlas-lifecycle
description: Inspect Atlas service health, consolidate memory, preview pruning, or perform explicitly approved lifecycle maintenance.
---

# Atlas lifecycle

1. Use `atlas_health` for service and datastore readiness diagnostics.
2. Run `atlas_consolidate` only when the user requests lifecycle maintenance; explain that it mutates memory.
3. Always call `atlas_prune` with `dry_run: true` first.
4. Show the candidate count and threshold, then obtain explicit confirmation before calling with `dry_run: false`.
5. Use `atlas_admin_rebuild_index` or `atlas_admin_debug_semantic` only for an explicit operator request and pass `confirm: true`.
6. Report failures without retrying destructive actions automatically.
