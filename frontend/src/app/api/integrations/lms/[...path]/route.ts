import { createBackendProxyRoute } from '@/lib/api/proxy';

// Browser -> /api/integrations/lms/... -> Django /integrations/lms/...
export const { GET, POST, PUT, PATCH, DELETE } = createBackendProxyRoute('integrations/lms', {
  trailingSlash: false,
});
