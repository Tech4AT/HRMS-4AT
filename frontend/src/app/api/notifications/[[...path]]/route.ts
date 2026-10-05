import { createBackendProxyRoute } from '@/lib/api/proxy';

// Browser → /api/notifications/... → proxyToBackend() → NestJS /notifications/...
export const { GET, POST, PUT } = createBackendProxyRoute('notifications');
