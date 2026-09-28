# RBAC: Module Self-Registration + Permission UI Redesign

Two asks, one design: (1) research a way for modules to **self-register** so the
system is plug-and-play, and (2) reorganize the **permission-granting UI** to the
Keka model (feature-grouped, short labels, searchable, only built modules).

The good news: **permissions already self-register.** Each app ships
`<app>/rbac.py` that calls `register_permissions(PermissionSpec(...))`; it's
auto-imported at startup (`core.apps.CoreConfig.ready`) and synced to the DB
after every migrate. A new module drops in an `rbac.py` and its permissions
appear. What's missing is (a) richer metadata so the UI can group and label them
well, and (b) a "this module is built/enabled" signal so half-done modules stop
showing up. This doc closes those two gaps.

---

## Part A — Self-registration (research + design)

### Today
`PermissionSpec(code, description, default_grants)`. Grouping in the UI is
*guessed* from the code prefix (`payroll.read` → "Payroll") in
`frontend/src/lib/admin/permissionGroups.ts`. Weaknesses: `org.manage` lives in
the employees app; the on-screen label is the long `description` sentence; and
there is no notion of whether a module is actually built.

### Design: a Module Manifest
Extend the registry so a module declares itself once, in `<app>/rbac.py`:

```python
register_module(ModuleSpec(
    key="employees",
    label="Employee data",        # feature-area name shown as a group header
    enabled=True,                 # False = hidden from role UI + nav until built
    permissions=[
        PermissionSpec("employees.read", label="View employee records",
                       description="View employee directory records within the holder's scope",
                       group="Employee data",
                       default_grants={...}),
        ...
    ],
))
```

Additions (all backward-compatible, `PermissionSpec` gains two optional fields):
- **`label`** — short verb phrase for the checkbox/row ("View employee records").
  Keka-style. The long `description` becomes the info-tooltip text.
- **`group`** — the feature area the permission belongs to, so grouping is
  authoritative (not prefix-guessed). Defaults to the module label.
- **`ModuleSpec.enabled`** — the single switch that decides whether a module's
  permissions and nav entry show. `leave`, `attendance` → `enabled=False` until
  their real backends exist; that one flag replaces hand-hiding nav entries.

### What self-registers, end to end
1. **Permissions** → already synced to DB (unchanged).
2. **Grouping + labels** → served from the registry via the permissions API
   (new fields `label`, `group`), so the UI stops guessing.
3. **"Built modules only"** → the catalog endpoint filters to `enabled` modules.
4. **Nav (future)** → a module can also declare its nav entry, so enabling a
   module lights up its sidebar item and its permissions together. (Phase 2 —
   for now nav stays hand-maintained; see the hidden entries in
   `frontend/src/app/(app)/layout.tsx`.)

### Why not a database table
Keep the source of truth in code (`rbac.py`), synced to the DB. Code review sees
every permission change in a diff, startup validation catches typos
(`core.checks`), and a fresh DB is always correct. A DB-first registry loses all
three. (`ponytail`: reuse the mechanism that already works, extend it.)

---

## Part B — Permission UI redesign (Keka model)

Target (from the reference screenshots):
- **Roles list**: cards/rows — role name + description, **scope** (Global / scoped),
  **permission count** (e.g. `19/19` + "View"), **user chips**, row actions,
  "+ New Role". (`RolesTab.tsx` is already close — polish to this layout.)
- **Users tab**: each user, their roles, permission count, manage action.
  (`PeopleTab.tsx` exists — align.)
- **Create/Edit Role editor**: left rail = **feature groups** (Employee data,
  Payroll, Organisation, …), each showing "N selected"; right = that group's
  permissions as checkboxes with a group select-all, a **short label**, an **info
  (i) tooltip** carrying the long description, and a **Search privileges** box.
  (`RoleBuilder.tsx` already implements this shape — the fixes below make it
  match Keka.)

### Concrete changes
1. **Backend** (`core/registry.py`, each `<app>/rbac.py`, `accounts/serializers.py`):
   - Add `label`, `group` to `PermissionSpec`; add `ModuleSpec`/`register_module`
     with `enabled`. Backfill short labels + groups for the built modules.
   - `PermissionSerializer` returns `code, label, description, group`.
   - Permissions catalog endpoint filters to `enabled` modules only.
2. **Frontend**:
   - `permissionGroups.ts`: group by the backend `group` field (fallback to
     prefix), drop the hardcoded map.
   - `RoleBuilder.tsx`: show `label` on the row, `description` in an (i) tooltip
     (not the whole sentence inline). Keep the left rail + search + counts.
   - `ExceptionsTab.tsx` / `PeopleTab.tsx`: replace the flat
     "Choose a permission…" `<select>` with the same **grouped, searchable
     picker** used by RoleBuilder. This is the "too vague / too long" screen.
   - Only built modules appear (catalog already filtered server-side).

### Built modules to surface (from docs/RBAC-WIRING-AUDIT.md)
Enabled: **Employee data, Self-service, Organisation, Org changes, Payroll,
Access control (roles), Audit, Approvals, Documents.**
Disabled until built: **Leaves/attendance (example_leave is a reference only),
Onboarding is present but unenforced (`IsAuthenticated`) — surface only once it
enforces its codes.**

---

## Task list (for the build)
- **B1** registry: `label`/`group` on PermissionSpec + `ModuleSpec`/`register_module`(`enabled`); keep sync idempotent.
- **B2** backfill each built `<app>/rbac.py` with short labels + group + module enabled; mark leave/attendance disabled.
- **B3** `PermissionSerializer` + catalog endpoint: expose `label`,`group`; filter to enabled modules.
- **B4** `RoleBuilder.tsx`: label rows + (i) description tooltip; groups from backend.
- **B5** `ExceptionsTab`/`PeopleTab`: grouped searchable permission picker (replace flat select).
- **B6** `permissionGroups.ts`: use backend `group`.
- Tests: registry round-trip (label/group/enabled), catalog excludes disabled modules, serializer fields. Author Nandini, additive migrations, preserve DB.
