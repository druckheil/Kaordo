import type { ProfilePointer } from '../domain/profile';
import type { ProfileApiGateway, ProfileCommit, ProfileCommitInput, ProfileReservation } from './ProfileGateway';
import { requestJson } from './WebApiClient';

const PROFILE_UNAVAILABLE = 'Profile storage is unavailable.';

type ProfileResponse = { profile: ProfilePointer | null };

export class WebProfileApiGateway implements ProfileApiGateway {
  async get(): Promise<ProfilePointer | null> {
    return (await requestJson<ProfileResponse>('/api/profile', {}, PROFILE_UNAVAILABLE)).profile;
  }

  reserve(nodeId: string, bytes: number): Promise<ProfileReservation> {
    return requestJson('/api/profile/reservations', {
      body: JSON.stringify({ bytes, nodeId }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }, PROFILE_UNAVAILABLE);
  }

  async commit(reservationId: string, input: ProfileCommitInput): Promise<ProfileCommit> {
    const result = await requestJson<{ previous: ProfilePointer | null; profile: ProfilePointer }>(
      `/api/profile/reservations/${encodeURIComponent(reservationId)}`,
      {
        body: JSON.stringify(input),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    PROFILE_UNAVAILABLE);
    return { pointer: result.profile, previous: result.previous };
  }

  async cancel(reservationId: string): Promise<void> {
    await requestJson<{ ok: boolean }>(
      `/api/profile/reservations/${encodeURIComponent(reservationId)}`,
      { method: 'DELETE' },
      PROFILE_UNAVAILABLE,
    );
  }
}
