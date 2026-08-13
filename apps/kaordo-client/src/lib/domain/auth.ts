export type AuthUser = {
  createdAt: number;
  id: string;
  role: 'admin' | 'superadmin' | 'user';
  username: string;
};

export type AuthMode = 'login' | 'register';
