import { createBackendProxyRoute } from '@/lib/api/proxy';

// Browser → /api/assets → Django /assets/ (asset inventory list + create).
export const { GET, POST } = createBackendProxyRoute('assets');
