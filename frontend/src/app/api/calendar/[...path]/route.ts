import { createBackendProxyRoute } from '@/lib/api/proxy';

// Browser → /api/calendar/... → proxyToBackend() → backend /calendar/...
export const { GET, POST, PUT, PATCH, DELETE } = createBackendProxyRoute('calendar');
