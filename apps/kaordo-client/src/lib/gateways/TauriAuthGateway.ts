import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { AuthSession, AuthUser } from '../domain/auth';
import type { AuthGateway } from './AuthGateway';
import type { TauriInvoke } from './TauriWorkspaceGateway';

export class TauriAuthGateway implements AuthGateway {
  readonly #invoke: TauriInvoke;

  constructor(invoke: TauriInvoke = tauriInvoke) {
    this.#invoke = invoke;
  }

  currentUser(): Promise<AuthUser | null> {
    return this.#invoke<AuthUser | null>('auth_me');
  }

  login(username: string, password: string): Promise<AuthUser> {
    return this.#invoke<AuthUser>('auth_login', { password, username });
  }

  register(username: string, password: string): Promise<AuthUser> {
    return this.#invoke<AuthUser>('auth_register', { password, username });
  }

  logout(): Promise<void> {
    return this.#invoke('auth_logout');
  }

  presence(): Promise<void> {
    return this.#invoke('auth_presence');
  }

  async listSessions(): Promise<AuthSession[]> {
    const result = await this.#invoke<{ sessions: AuthSession[] }>('auth_sessions');
    return result.sessions;
  }

  terminateSession(sessionId: string): Promise<void> {
    return this.#invoke('auth_terminate_session', { sessionId });
  }
}
