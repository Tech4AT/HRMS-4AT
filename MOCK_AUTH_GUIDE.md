# Mock Authentication Setup Guide

## ✅ Setup Complete

Mock authentication is now enabled for local development. You can login without a backend database!

## How to Login

Start the dev server:
```bash
cd frontend
npm run dev
```

Then navigate to `http://localhost:3001/login` and use any of these test accounts:

### Test Accounts

| Email | Role | Scope | Use Case |
|---|---|---|---|
| **admin@company.com** | HR Admin | Org-wide | View/manage all employees, approve leave, view payroll |
| **manager@company.com** | Manager | Team | Approve team leave/attendance, view team records |
| **employee@company.com** | Employee | Self | View own record, submit leave/expense requests |
| **finance@company.com** | Finance | Org-wide | View payroll, approve expenses org-wide |

**Password:** Use any password (mock auth accepts all passwords)

---

## What Each Role Can Do

### HR Admin (`admin@company.com`)
- ✅ Read/write all employee data
- ✅ Approve leave, attendance, expense requests
- ✅ View payroll (read-only)
- ✅ Manage organization structure (departments, designations)
- ✅ Org-wide scope — can see everyone

### Manager (`manager@company.com`)
- ✅ Read own record + direct reports (emp-002, emp-003, emp-004)
- ✅ Approve team's leave/attendance/expense requests
- ✅ Team scope — can only see direct reports

### Employee (`employee@company.com`)
- ✅ Read own record
- ✅ Submit leave/expense requests
- ✅ View own payroll
- ✅ Self scope — can only see own data

### Finance (`finance@company.com`)
- ✅ Read payroll org-wide
- ✅ Write payroll (create slips, etc.)
- ✅ Approve expense requests
- ✅ Read all employee data (payroll-related only)
- ✅ Org-wide scope — can see payroll data for everyone

---

## Customizing Mock Users

Edit `frontend/src/lib/api/mock-auth.ts` to:
- Add new test users
- Modify permissions
- Change scopes
- Add more direct reports for managers

Example: To add a "compliance" role:
```typescript
compliance: {
  id: 'mock-compliance-1',
  email: 'compliance@company.com',
  firstName: 'Compliance',
  lastName: 'Officer',
  roles: [{ name: 'admin' }],  // or custom role
  permissions: ['employee.read', 'audit.read', 'scope.all'],
  scope: { kind: 'org' },
}
```

---

## Key Points

- ✅ **No database needed** — everything is in-memory mock data
- ✅ **All passwords work** — mock auth accepts any password for any email
- ✅ **Frontend untouched** — login flow, UI, and auth context work normally
- ✅ **Easy to switch** — when Django backend is ready, just set `MOCK_AUTH=false` in `.env.local`

---

## Environment Variables

In `.env.local`:

```bash
# Enable mock authentication (bypass backend)
MOCK_AUTH=true

# Backend URL (used when MOCK_AUTH=false)
BACKEND_API_URL=http://localhost:3000/api/v1
```

---

## When Does Mock Auth Go Away?

Once the **Django backend is complete in Phase 1** (Sep 21–24):
1. Real `/auth/login` endpoint will be live
2. Real `/auth/me` endpoint with real roles/permissions
3. Set `MOCK_AUTH=false` in `.env.local`
4. Remove all `MOCK_AUTH_ENABLED` branches from code (cleanup in Phase 2)

---

## Troubleshooting

### Login redirects to login page
- Check that `MOCK_AUTH=true` is set in `.env.local`
- Restart dev server after changing `.env.local`
- Check browser console for errors

### Wrong permissions after login
- Verify the email matches one of the test accounts exactly (case-insensitive)
- Check `frontend/src/lib/api/mock-auth.ts` for the role definition

### Need a different test scenario?
- Edit `MOCK_USERS` in `mock-auth.ts` to customize roles/permissions
- No need to restart dev server after changes to `.ts` files (Next.js HMR)

---

## Development Workflow

1. **Develop features** with mock auth enabled
2. **Test with different roles** by logging in with different emails
3. **Verify permission logic** (can manager see team? can employee only see self?)
4. **When Django backend is ready** (Phase 1):
   - Backend team publishes real auth endpoints
   - Switch `MOCK_AUTH=false`
   - Frontend tests validate real auth works
5. **Clean up** mock auth code in Phase 2 hardening

---

**Next step:** Run `npm run dev` in the `frontend/` directory and start building! 🚀
