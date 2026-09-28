import { createBackendProxyRoute } from '@/lib/api/proxy';

// Browser -> /api/onboarding/... -> proxyToBackend() -> Django /onboarding/...
export const { GET, POST, PUT, PATCH, DELETE } = createBackendProxyRoute('onboarding');
