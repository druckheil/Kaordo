import type { AuthUser } from '../domain/auth';

export interface AuthGateway {
  currentUser(): Promise<AuthUser | null>;
  login(username: string, password: string): Promise<AuthUser>;
  register(username: string, password: string): Promise<AuthUser>;
  logout(): Promise<void>;
  presence(): Promise<void>;
}
