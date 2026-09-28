# Access Control UI — Keka-style rebuild (/admin)

Rebuild the `/admin` (Access Control) screens to match the Keka reference. Scope
decided with the user: **full restructure to Keka's tabs**, **Implicit Roles
skipped for now**, **Access Control screens only — do NOT touch the sidebar/nav
or any other page**. Frontend-only; the backend already exposes everything.

## Current → target
Today `/admin` has 5 tabs: Roles & permissions, Permissions by module, People,
Personal exceptions, Activity log. That is the "redundant" clutter. Collapse to:

1. **User Roles** (was RolesTab) — primary tab.
2. **Users** (was PeopleTab) — Keka "Users" list.
3. **Activity log** — keep, but as a secondary/минor tab or a link, not a peer of the two above.

Remove the **"Permissions by module"** tab (PermissionsTab) — it duplicates the
role-grant editing that the Create/Edit Role editor already does. Fold **Personal
exceptions** into the Users tab: a user row's kebab → "Manage exceptions" opens
the existing exception add/remove flow (reuse ExceptionsTab logic + the grouped
PermissionPicker), so it stops being its own top-level tab.

Keep the **Create/Edit Role editor** (RoleBuilder) — it already matches Keka's
"Create New Role" (left rail feature groups, grouped searchable checkboxes with
short labels + (i) tooltips, name/description, Save/Cancel). Wire "+ New Role" and
each role row's Actions → Edit to it.

## Tab 1 — User Roles (reference image 1)
Header: title "User Roles", one-line subtitle, a **Search Roles** box (filters the
list client-side), and a **+ New Role** button (primary/purple), on the right.

Table columns: **USER ROLES | SCOPE | PERMISSIONS | USERS | ACTIONS**. Each row:
- **User Roles**: an "Inbuilt" pill for seeded/system roles (Role has an
  archetype / a not-custom flag — use whatever marks starter roles; if none,
  treat the seeded starter roles by name), then the role **name** (bold) and its
  **description** (gray, wraps).
- **Scope**: bold head + gray sub — "Global / Across all employees" when every
  grant is ALL tier, else "Scoped / By team · department" (reuse the existing
  `roleScope()` helper).
- **Permissions**: a **Full Access** pill (green) when the role holds every
  registered permission at ALL, else **Limited** (gray); then `N / total` and an
  eye **View** link that opens the role in the editor read-only (or just opens
  Edit).
- **Users**: "Added users (N)" then **avatar chips** of the assigned users
  (initials avatar + name; overflow "+N"). Use the role's user list from the API.
- **Actions**: a kebab (⋮) menu — Edit, and Delete for custom (non-inbuilt) roles.

## Tab 2 — Users (reference image 2)
Header: title "Users", subtitle, a **Search by name or employee number** box.
Columns: **USERS | ROLES | PERMISSIONS | ACTIONS**. Each row:
- **Users**: initials/photo avatar + **name** (bold) + **designation** (gray sub).
- **Roles**: the user's role name(s); "+N" overflow if several.
- **Permissions**: effective count `N / total`.
- **Actions**: kebab — "Change role" and "Manage exceptions" (opens the folded
  exceptions flow for that user).

## Data (already available — do not change the backend)
- Roles: `/api/v1/roles/` (name, description, permissions[], user_count, users).
- Users: `/api/v1/users/` (name, designation, role, effective permission count).
- Permission catalog (grouped, enabled only): the catalog endpoint samantha added.
- Per-user overrides: `/api/v1/user-permission-overrides/` (the exceptions flow).
If a field the layout needs is genuinely missing from an endpoint, note it and use
what exists — do not invent backend changes without flagging.

## Boundaries
- Frontend only. No backend/model/migration changes. No nav/sidebar edits. No
  Implicit Roles. Do not touch any page outside `frontend/src/app/(app)/admin/**`
  and `frontend/src/components/admin/**`.
- Keep it accessible (roles/tabs, keyboard), responsive to phone width, and reuse
  the existing `components/admin/ui.tsx` primitives + PermissionPicker.
- `noUnusedLocals` is on — remove dead imports. `npx tsc --noEmit` must be clean.
- Author Nandini Velamuri, no AI mentions, commit per tab/step.
