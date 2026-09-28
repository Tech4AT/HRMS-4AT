import { createBackendProxyRoute } from '@/lib/api/proxy';

// Browser → /api/attendance/... → proxyToBackend() → backend /attendance/...
// DELETE added for Shifts (PLAN.md Step 6/11) — nothing under this prefix
// needed it before (attendance records/requests are never deleted via API).
export const { GET, POST, PUT, PATCH, DELETE } = createBackendProxyRoute('attendance');
