import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { ProfilePointer } from '../domain/profile';
import type { TauriInvoke } from './TauriWorkspaceGateway';
import type { ProfileApiGateway, ProfileCommit, ProfileCommitInput, ProfileReservation } from './ProfileGateway';

export class TauriProfileApiGateway implements ProfileApiGateway {
  constructor(private readonly invoke: TauriInvoke = tauriInvoke) {}

  async get(): Promise<ProfilePointer | null> {
    const result = await this.invoke<{ profile: ProfilePointer | null }>('profile_get');
    return result.profile;
  }

  reserve(nodeId: string, bytes: number): Promise<ProfileReservation> {
    return this.invoke<ProfileReservation>('profile_reserve', { bytes, nodeId });
  }

  async commit(reservationId: string, input: ProfileCommitInput): Promise<ProfileCommit> {
    const result = await this.invoke<{ previous: ProfilePointer | null; profile: ProfilePointer }>('profile_commit', {
      reservationId,
      input,
    });
    return { pointer: result.profile, previous: result.previous };
  }

  async cancel(reservationId: string): Promise<void> {
    await this.invoke('profile_cancel', { reservationId });
  }
}
