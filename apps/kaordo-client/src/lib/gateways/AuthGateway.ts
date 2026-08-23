import type { AuthSession, AuthUser } from '../domain/auth';

export interface AuthGateway {
  currentUser(): Promise<AuthUser | null>;
  login(username: string, password: string): Promise<AuthUser>;
  register(username: string, password: string): Promise<AuthUser>;
  changeUsername(currentUsername: string, newUsername: string, currentPassword: string): Promise<AuthUser>;
  changePassword(username: string, currentPassword: string, newPassword: string): Promise<void>;
  logout(): Promise<void>;
  presence(): Promise<void>;
  listSessions(): Promise<AuthSession[]>;
  terminateSession(sessionId: string): Promise<void>;
}
