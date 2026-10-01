'use client';

import { useRequireAccess } from '@/lib/auth/useRequireAccess';
import EmployeeBulkUpload from '@/components/EmployeeBulkUpload';

export default function AdminEmployeesPage() {
  const { user } = useRequireAccess({ requireSuperAdmin: true });

  if (!user?.is_superuser) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
          <p className="text-gray-600 mt-2">Only superadmin users can access this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">👨‍💼 Employee Administration</h1>
        <p className="text-gray-600 mt-2">Manage employees, departments, and designations</p>
      </div>

      <EmployeeBulkUpload />
    </div>
  );
}
