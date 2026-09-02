export type AuthUser = {
  createdAt: number;
  id: string;
  role: 'admin' | 'superadmin' | 'user';
  seedIssued?: boolean;
  username: string;
};

export type AuthSession = {
  clientKind: 'desktop' | 'web';
  createdAt: number;
  current: boolean;
  deviceName: string | null;
  expiresAt: number;
  id: string;
  lastActiveAt: number;
};

export type AuthMode = 'login' | 'register';
