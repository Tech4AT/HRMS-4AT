import { createBackendProxyRoute } from '@/lib/api/proxy';

// Browser → /api/assets/... → Django /assets/... (asset inventory).
export const { GET, PATCH, DELETE } = createBackendProxyRoute('assets');
