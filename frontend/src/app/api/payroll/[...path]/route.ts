import { createBackendProxyRoute } from '@/lib/api/proxy';

// /api/payroll/<path> -> backend /api/v1/payroll/<path>/ (the payroll module API).
export const { GET, POST, PUT, PATCH, DELETE } = createBackendProxyRoute('payroll');
