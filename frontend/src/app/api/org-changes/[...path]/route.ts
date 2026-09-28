import { createBackendProxyRoute } from '@/lib/api/proxy';

// Browser -> /api/org-changes/... -> proxyToBackend() -> Django /org-changes/...
export const { GET, POST, PUT, PATCH, DELETE } = createBackendProxyRoute('org-changes');
