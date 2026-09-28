import { createBackendProxyRoute } from '@/lib/api/proxy';

export const { GET, POST, PUT, PATCH, DELETE } = createBackendProxyRoute('payroll/inputs');
