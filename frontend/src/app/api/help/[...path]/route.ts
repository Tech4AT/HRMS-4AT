import { createBackendProxyRoute } from '@/lib/api/proxy';

// Browser → /api/help/... → proxyToBackend() → Django /help/...
export const { GET, POST, PUT, PATCH, DELETE } = createBackendProxyRoute('help', { trailingSlash: false });
