'use client';

import { createContext, useState, useEffect, type ReactNode } from 'react';

export type ManagementScope =
  | { kind: 'org' }
  | { kind: 'team'; employeeIds: string[] }
  | { kind: 'self' };

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  permissions: string[];
  scope: ManagementScope;
  is_superuser?: boolean;
  /** True when an admin issued a temporary password — the user must change
   * it before using the app (T06). Surfaced as `mustChangePassword` by the
   * backend login response and GET /users/me. */
  mustChangePassword: boolean;
}

export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasOrgScope: () => boolean;
  updateProfile: (updates: { firstName: string; lastName: string }) => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async (): Promise<User | null> => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.data);
        return data.data as User;
      } else {
        setUser(null);
        return null;
      }
    } catch (error) {
      setUser(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(
          error?.error?.message || error?.message || 'Login failed'
        );
      }

      const data = await response.json();
      setUser(data.data.user);

      // Fetch full user data with real role and permissions; the fresh /me
      // value carries mustChangePassword (T06), falling back to login's.
      const me = await checkAuth();
      const flag =
        me?.mustChangePassword ?? data?.data?.user?.mustChangePassword ?? false;
      return flag === true;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      setUser(null);
    }
  };

  const hasPermission = (permission: string): boolean => {
    if (!user) return false;
    return user.permissions.includes(permission);
  };

  const hasOrgScope = (): boolean => {
    return user?.scope.kind === 'org';
  };

  const updateProfile = async (updates: { firstName: string; lastName: string }) => {
    const response = await fetch('/api/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to update profile');
    }

    const data = await response.json();
    setUser((prev) => (prev ? { ...prev, firstName: data.data.firstName, lastName: data.data.lastName } : prev));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        hasPermission,
        hasOrgScope,
        updateProfile,
        refreshUser: async () => {
          await checkAuth();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
