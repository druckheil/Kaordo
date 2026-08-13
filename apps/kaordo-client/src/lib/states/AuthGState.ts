import type { AuthMode, AuthUser } from '../domain/auth';
import type { AuthGateway } from '../gateways/AuthGateway';
import { GState } from '../state/GState';

export type AuthSnapshot = {
  error: string | null;
  phase: 'checking' | 'anonymous' | 'submitting' | 'authenticated';
  user: AuthUser | null;
};

export class AuthGState extends GState<AuthSnapshot> {
  readonly #gateway: AuthGateway;
  #lastPresenceAt = 0;
  #requestId = 0;

  constructor(gateway: AuthGateway, initialUser: AuthUser | null = null) {
    super({
      error: null,
      phase: initialUser ? 'authenticated' : 'checking',
      user: initialUser,
    });
    this.#gateway = gateway;
  }

  override enter(): void {
    if (this.snapshot.phase === 'authenticated') return;
    void this.restore();
  }

  override exit(): void {
    this.#requestId += 1;
  }

  clearError(): void {
    if (this.snapshot.error) this.publish({ ...this.snapshot, error: null });
  }

  async authenticate(mode: AuthMode, username: string, password: string): Promise<boolean> {
    if (this.snapshot.phase === 'submitting') return false;
    const requestId = ++this.#requestId;
    this.publish({ error: null, phase: 'submitting', user: null });
    try {
      const user = await this.#gateway[mode](username, password);
      if (requestId !== this.#requestId) return false;
      this.publish({ error: null, phase: 'authenticated', user });
      return true;
    } catch (error) {
      if (requestId !== this.#requestId) return false;
      this.publish({ error: readableError(error), phase: 'anonymous', user: null });
      return false;
    }
  }

  async logout(): Promise<boolean> {
    if (this.snapshot.phase !== 'authenticated') return false;
    const requestId = ++this.#requestId;
    this.publish({ ...this.snapshot, error: null });
    try {
      await this.#gateway.logout();
      if (requestId !== this.#requestId) return false;
      this.publish({ error: null, phase: 'anonymous', user: null });
      return true;
    } catch (error) {
      if (requestId !== this.#requestId) return false;
      this.publish({ ...this.snapshot, error: readableError(error) });
      return false;
    }
  }

  markPresent(): void {
    const now = Date.now();
    if (this.snapshot.phase !== 'authenticated' || now - this.#lastPresenceAt < 10 * 60_000) {
      return;
    }
    this.#lastPresenceAt = now;
    void this.#gateway.presence().catch(() => {
      // Presence is best-effort and must never interrupt the user's work.
    });
  }

  private async restore(): Promise<void> {
    const requestId = ++this.#requestId;
    this.publish({ error: null, phase: 'checking', user: null });
    try {
      const user = await this.#gateway.currentUser();
      if (requestId !== this.#requestId) return;
      this.publish({
        error: null,
        phase: user ? 'authenticated' : 'anonymous',
        user,
      });
    } catch (error) {
      if (requestId !== this.#requestId) return;
      this.publish({ error: readableError(error), phase: 'anonymous', user: null });
    }
  }
}

function readableError(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'The authentication service is unavailable.';
}
