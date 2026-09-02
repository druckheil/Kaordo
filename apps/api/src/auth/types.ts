export const ACCOUNT_STATUS_ACTIVE = 1;
export const ACCOUNT_ROLE_USER = 0;
export const ACCOUNT_ROLE_ADMIN = 1;
export const ACCOUNT_ROLE_SUPERADMIN = 2;
export const SUPERADMIN_USERNAME = 'druckheil';
export const CLIENT_WEB = 0;
export const CLIENT_DESKTOP = 1;

export type AuthClientKind = typeof CLIENT_WEB | typeof CLIENT_DESKTOP;

export type PublicUser = {
  createdAt: number;
  id: string;
  role: 'admin' | 'superadmin' | 'user';
  seedIssued?: boolean;
  username: string;
};

export type UserRow = {
  created_at: number;
  display_username: string;
  id: ArrayBuffer;
  last_seen_at: number;
  password_algorithm: number;
  password_hash: ArrayBuffer;
  password_iterations: number;
  password_salt: ArrayBuffer;
  status: number;
  role: number;
  seed_issued: number;
  username: string;
};

export type SessionUserRow = {
  created_at: number;
  display_username: string;
  expires_at: number;
  id: ArrayBuffer;
  last_used_at: number;
  last_seen_at: number;
  role: number;
  seed_issued: number;
  status: number;
  username: string;
};

export function accountRole(username: string, role: number): PublicUser['role'] {
  if (username === SUPERADMIN_USERNAME || role === ACCOUNT_ROLE_SUPERADMIN) {
    return 'superadmin';
  }
  return role === ACCOUNT_ROLE_ADMIN ? 'admin' : 'user';
}

export function isAdmin(user: Pick<PublicUser, 'role'>): boolean {
  return user.role === 'admin' || user.role === 'superadmin';
}

export function isRootSuperadmin(
  user: PublicUser,
  rootUserId: string | undefined,
): boolean {
  return user.role === 'superadmin'
    && user.username.toLowerCase() === SUPERADMIN_USERNAME
    && typeof rootUserId === 'string'
    && sameString(user.id, rootUserId);
}

function sameString(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
