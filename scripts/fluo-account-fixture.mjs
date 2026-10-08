// Shares contract-shaped profile, presence and encryption responses across strict synthetic browser fixtures
import { encryptionFixture } from './encryption-fixture.mjs';

export function fluoAccountFixtureResponse(request, accounts, { viewerId, privacy, records }) {
  const path = new URL(request.url()).pathname;
  const encrypted = encryptionFixture(request, accounts, viewerId, { privacy, records }).response();
  if (encrypted) return encrypted;
  const presentation = account => ({
    id: account.id,
    avatar: account.avatar ?? null,
    presence: account.id === viewerId && privacy?.presenceVisibility === 'off' ? null : account.id === viewerId ? 'online' : 'offline',
  });
  if (path === '/v1/fluo/presence' && request.method() === 'POST') {
    const requested = new Set(request.postDataJSON().userIds);
    return { items: accounts.filter(account => requested.has(account.id)).map(presentation) };
  }
  if (path.startsWith('/v1/fluo/profiles/') && request.method() === 'GET') {
    const username = decodeURIComponent(path.slice('/v1/fluo/profiles/'.length));
    const account = accounts.find(account => account.username.toLowerCase() === username.toLowerCase());
    if (!account) throw new Error(`Unknown fixture profile: ${username}`);
    const own = account.id === viewerId;
    return {
      ...account, ...presentation(account), following: account.following ?? false, verified: account.verified ?? false,
      bio: '', birthDate: null, location: '', website: '', pronouns: '', banner: null,
      createdAt: account.createdAt ?? '2026-10-03T10:00:00Z', followersCount: 0, followingCount: 0,
      followedBy: false, accountVisibility: own ? privacy?.accountVisibility ?? 'public' : 'public', canViewPosts: true,
      ...(own && privacy?.presenceVisibility !== 'off' ? { status: 'online' } : {}),
    };
  }
}
