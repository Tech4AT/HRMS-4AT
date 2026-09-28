import { createBackendProxyRoute } from '@/lib/api/proxy';

// Browser -> /api/policies/... -> Django /policies/...
export const { GET, POST, PUT, PATCH, DELETE } = createBackendProxyRoute('policies');
