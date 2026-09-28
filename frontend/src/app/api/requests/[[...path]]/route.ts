import { createBackendProxyRoute } from '@/lib/api/proxy';

// Browser → /api/requests/... → proxyToBackend() → backend /requests/...
export const { GET, POST } = createBackendProxyRoute('requests');
