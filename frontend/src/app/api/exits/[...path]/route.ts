import { createBackendProxyRoute } from '@/lib/api/proxy';

// Browser -> /api/exits/... -> Django /exits/...
export const { GET, POST, PUT, PATCH, DELETE } = createBackendProxyRoute('exits');
