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
    if (this.snapshot.phase === 'authenticated') {
      return;
    }
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

  async authenticateWithSeed(seedPhrase: string): Promise<boolean> {
    if (this.snapshot.phase === 'submitting') return false;
    const requestId = ++this.#requestId;
    this.publish({ error: null, phase: 'submitting', user: null });
    try {
      const user = await this.#gateway.loginWithSeed(seedPhrase);
      if (requestId !== this.#requestId) return false;
      this.publish({ error: null, phase: 'authenticated', user });
      return true;
    } catch (error) {
      if (requestId !== this.#requestId) return false;
      this.publish({ error: readableError(error), phase: 'anonymous', user: null });
      return false;
    }
  }

  async issueSeed(): Promise<string> {
    if (this.snapshot.phase !== 'authenticated') {
      throw new Error('Authentication is required.');
    }
    try {
      const seedPhrase = await this.#gateway.issueSeed();
      const currentUser = this.snapshot.user;
      this.publish({
        ...this.snapshot,
        error: null,
        user: currentUser ? { ...currentUser, seedIssued: true } : currentUser,
      });
      return seedPhrase;
    } catch (error) {
      const message = readableError(error);
      this.publish({ ...this.snapshot, error: message });
      throw new Error(message);
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

  async changeUsername(newUsername: string, currentPassword: string): Promise<boolean> {
    const currentUser = this.snapshot.user;
    if (this.snapshot.phase !== 'authenticated' || !currentUser) return false;
    const requestId = ++this.#requestId;
    this.publish({ ...this.snapshot, error: null });
    try {
      const user = await this.#gateway.changeUsername(
        currentUser.username,
        newUsername,
        currentPassword,
      );
      if (requestId !== this.#requestId) return false;
      this.publish({ error: null, phase: 'authenticated', user });
      return true;
    } catch (error) {
      if (requestId !== this.#requestId) return false;
      this.publish({ ...this.snapshot, error: readableError(error) });
      return false;
    }
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
    const currentUser = this.snapshot.user;
    if (this.snapshot.phase !== 'authenticated' || !currentUser) return false;
    const requestId = ++this.#requestId;
    this.publish({ ...this.snapshot, error: null });
    try {
      await this.#gateway.changePassword(currentUser.username, currentPassword, newPassword);
      if (requestId !== this.#requestId) return false;
      this.publish({ ...this.snapshot, error: null });
      return true;
    } catch (error) {
      if (requestId !== this.#requestId) return false;
      this.publish({ ...this.snapshot, error: readableError(error) });
      return false;
    }
  }

  handleSessionRevoked(): void {
    if (this.snapshot.phase !== 'authenticated') return;
    // Clear the platform credential as well as the in-memory projection. The
    // revocation event is authoritative, so this best-effort logout does not
    // block the UI transition and is only one request for an exceptional path.
    void this.#gateway.logout().catch(() => undefined);
    this.expireSession();
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

  private expireSession(): void {
    this.#requestId += 1;
    this.publish({ error: null, phase: 'anonymous', user: null });
  }
}

function readableError(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'The authentication service is unavailable.';
}
