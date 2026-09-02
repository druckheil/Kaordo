import type { Env } from './env';
import {
  CLIENT_DESKTOP,
  CLIENT_WEB,
  changePassword,
  changeUsername,
  login,
  seedLogin,
  issueSeed,
  logout,
  me,
  presence,
  register,
  sessions,
  terminateSession,
} from './auth/routes';
import { json } from './http/json';
import { health } from './routes/health';
import { fluoBootstrap } from './fluo/bootstrap';
import { fluoLikeStates, setFluoLike } from './fluo/likes';
import { adminDashboard } from './admin/dashboard';
import { adminCloudflareTelemetry } from './admin/telemetry';
import {
  adminBanUser,
  adminEraseUser,
  adminResetUserSeed,
  adminUnbanUser,
} from './admin/moderation';
import {
  cancelPublicStorage,
  commitPublicStorage,
  publicStorageStatus,
  releasePublicPost,
  reservePublicStorage,
} from './fluo/public-storage';
import {
  deleteNode,
  listNodes,
  listFluoNodeIds,
  nodeHeartbeat,
  issueNodeAccess,
  completeNodeQuickTest,
  nodeQuickTest,
  nodeRoute,
  relayNodeRequest,
  verifyNodeAccess,
  renameNode,
  updateNodePolicy,
  updateNodeSpaces,
} from './nodes/routes';
import {
  addRondoNode,
  createRondoInvite,
  createRondoRoom,
  createRondoSpace,
  deleteRondoRoom,
  joinRondoSpace,
  removeRondoNode,
  reorderRondoNodes,
  revokeRondoInvite,
  rondoBootstrap,
  rondoRoomRoute,
  rondoSpaceDetail,
  rondoVoiceIce,
  updateRondoSpace,
} from './rondo/routes';
import {
  acknowledgeLigoConversationDeletions,
  acknowledgeLigoDeletions,
  acknowledgeLigoDelivery,
  confirmLigoCloudCleanup,
  createLigoDelivery,
  deleteLigoConversation,
  deleteLigoMessage,
  ligoBootstrap,
  ligoHistory,
  ligoInbox,
  markLigoRead,
  searchLigoUsers,
  updateLigoStorage,
} from './ligo/routes';
import { createAuthLiveTicket, createLigoLiveTicket, openLigoLive } from './ligo/live';
import {
  cancelProfileStorage,
  commitProfileStorage,
  getProfile,
  reserveProfileStorage,
} from './profile/routes';
import {
  iloBootstrap,
  iloCards,
  iloCreateCard,
  iloDeleteCard,
  iloDeleteCards,
  iloGrade,
  iloProgress,
  iloTrainNext,
  iloUpdateCard,
} from './ilo/routes';
import {
  taglibroBootstrap,
  taglibroCreateEvent,
  taglibroDay,
  taglibroDeleteEvent,
  taglibroEvents,
  taglibroSaveDay,
  taglibroSaveDiary,
  taglibroSavePlans,
  taglibroUpdateEvent,
} from './ilo/taglibro';

const DESKTOP_AUTH_HOST = `${['veri', 'dimensio-api'].join('')}.pshenychnyi-ld.workers.dev`;

export function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Response | Promise<Response> {
  const { hostname, pathname } = new URL(request.url);

  if (pathname.startsWith('/api/auth/desktop/') && hostname !== DESKTOP_AUTH_HOST) {
    return json({ error: 'Not found.' }, 404);
  }

  if (request.method === 'GET' && pathname === '/api/health') {
    return health(env);
  }
  if (request.method === 'GET' && pathname === '/api/admin/dashboard') {
    return adminDashboard(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/admin/cloudflare') {
    return adminCloudflareTelemetry(request, env);
  }
  const adminUserAction = pathname.match(/^\/api\/admin\/users\/([A-Za-z0-9_-]{1,64})\/(ban|unban|erase|reset-seed)$/u);
  if (adminUserAction?.[1] && adminUserAction[2] === 'ban' && request.method === 'POST') {
    return adminBanUser(request, env, adminUserAction[1], ctx);
  }
  if (adminUserAction?.[1] && adminUserAction[2] === 'unban' && request.method === 'POST') {
    return adminUnbanUser(request, env, adminUserAction[1]);
  }
  if (adminUserAction?.[1] && adminUserAction[2] === 'erase' && request.method === 'POST') {
    return adminEraseUser(request, env, adminUserAction[1], ctx);
  }
  if (adminUserAction?.[1] && adminUserAction[2] === 'reset-seed' && request.method === 'POST') {
    return adminResetUserSeed(request, env, adminUserAction[1]);
  }
  if (request.method === 'POST' && pathname === '/api/nodes/heartbeat') {
    return nodeHeartbeat(request, env);
  }
  if (request.method === 'POST' && pathname === '/api/nodes/tickets/verify') {
    return verifyNodeAccess(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/nodes') {
    return listNodes(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/fluo/nodes') {
    return listFluoNodeIds(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/fluo/bootstrap') {
    return fluoBootstrap(request, env);
  }
  if (request.method === 'POST' && pathname === '/api/fluo/likes/query') {
    return fluoLikeStates(request, env);
  }
  if (request.method === 'PUT' && pathname === '/api/fluo/likes') {
    return setFluoLike(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/rondo/bootstrap') {
    return rondoBootstrap(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/ilo/bootstrap') {
    return iloBootstrap(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/ilo/cards') {
    return iloCards(request, env);
  }
  if (request.method === 'POST' && pathname === '/api/ilo/cards') {
    return iloCreateCard(request, env);
  }
  if (request.method === 'DELETE' && pathname === '/api/ilo/cards') {
    return iloDeleteCards(request, env);
  }
  const iloCardMatch = pathname.match(/^\/api\/ilo\/cards\/([0-9a-f]{8,32})$/u);
  if (request.method === 'PATCH' && iloCardMatch?.[1]) {
    return iloUpdateCard(request, env, iloCardMatch[1]);
  }
  if (request.method === 'DELETE' && iloCardMatch?.[1]) {
    return iloDeleteCard(request, env, iloCardMatch[1]);
  }
  if (request.method === 'GET' && pathname === '/api/ilo/train/next') {
    return iloTrainNext(request, env);
  }
  if (request.method === 'POST' && pathname === '/api/ilo/train/grade') {
    return iloGrade(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/ilo/progress') {
    return iloProgress(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/ilo/taglibro/bootstrap') {
    return taglibroBootstrap(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/ilo/taglibro/day') {
    return taglibroDay(request, env);
  }
  if (request.method === 'PUT' && pathname === '/api/ilo/taglibro/plans') {
    return taglibroSavePlans(request, env);
  }
  if (request.method === 'PUT' && pathname === '/api/ilo/taglibro/diary') {
    return taglibroSaveDiary(request, env);
  }
  if (request.method === 'PUT' && pathname === '/api/ilo/taglibro/day') {
    return taglibroSaveDay(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/ilo/taglibro/events') {
    return taglibroEvents(request, env);
  }
  if (request.method === 'POST' && pathname === '/api/ilo/taglibro/events') {
    return taglibroCreateEvent(request, env);
  }
  const taglibroEventMatch = pathname.match(/^\/api\/ilo\/taglibro\/events\/([0-9a-f]{8,32})$/u);
  if (taglibroEventMatch?.[1] && request.method === 'PATCH') {
    return taglibroUpdateEvent(request, env, taglibroEventMatch[1]);
  }
  if (taglibroEventMatch?.[1] && request.method === 'DELETE') {
    return taglibroDeleteEvent(request, env, taglibroEventMatch[1]);
  }
  if (request.method === 'GET' && pathname === '/api/ligo/bootstrap') {
    return ligoBootstrap(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/ligo/users') {
    return searchLigoUsers(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/ligo/inbox') {
    return ligoInbox(request, env);
  }
  if (request.method === 'PATCH' && pathname === '/api/ligo/storage') {
    return updateLigoStorage(request, env);
  }
  if (request.method === 'POST' && pathname === '/api/ligo/cloud-cleanup') {
    return confirmLigoCloudCleanup(request, env);
  }
  if (request.method === 'POST' && pathname === '/api/ligo/read') {
    return markLigoRead(request, env, ctx);
  }
  if (request.method === 'POST' && pathname === '/api/ligo/deletions/ack') {
    return acknowledgeLigoDeletions(request, env);
  }
  if (request.method === 'POST' && pathname === '/api/ligo/conversation-deletions/ack') {
    return acknowledgeLigoConversationDeletions(request, env);
  }
  const ligoHistoryMatch = pathname.match(/^\/api\/ligo\/history\/([a-z0-9_]+)$/u);
  if (request.method === 'GET' && ligoHistoryMatch?.[1]) {
    return ligoHistory(request, env, ligoHistoryMatch[1]);
  }
  if (request.method === 'POST' && pathname === '/api/ligo/live-ticket') {
    return createLigoLiveTicket(request, env);
  }
  if (request.method === 'POST' && pathname === '/api/auth/live-ticket') {
    return createAuthLiveTicket(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/ligo/live') {
    return openLigoLive(request, env);
  }
  if (request.method === 'POST' && pathname === '/api/ligo/deliveries') {
    return createLigoDelivery(request, env, ctx);
  }
  const ligoDeliveryMatch = pathname.match(/^\/api\/ligo\/deliveries\/([0-9a-f-]+)$/u);
  if (request.method === 'DELETE' && ligoDeliveryMatch?.[1]) {
    return acknowledgeLigoDelivery(request, env, ligoDeliveryMatch[1], ctx);
  }
  const ligoMessageMatch = pathname.match(/^\/api\/ligo\/messages\/([0-9a-f-]+)$/u);
  if (request.method === 'DELETE' && ligoMessageMatch?.[1]) {
    return deleteLigoMessage(request, env, ligoMessageMatch[1], ctx);
  }
  const ligoConversationMatch = pathname.match(/^\/api\/ligo\/conversations\/([a-z0-9_]+)$/u);
  if (request.method === 'DELETE' && ligoConversationMatch?.[1]) {
    return deleteLigoConversation(request, env, ligoConversationMatch[1], ctx);
  }
  if (request.method === 'GET' && pathname === '/api/rondo/voice/ice') {
    return rondoVoiceIce(request, env);
  }
  if (request.method === 'POST' && pathname === '/api/rondo/spaces') {
    return createRondoSpace(request, env);
  }
  if (request.method === 'POST' && pathname === '/api/rondo/join') {
    return joinRondoSpace(request, env);
  }
  const rondoInviteMatch = pathname.match(
    /^\/api\/rondo\/spaces\/([0-9a-f-]+)\/invites\/([0-9a-f-]+)$/u,
  );
  if (request.method === 'DELETE' && rondoInviteMatch?.[1] && rondoInviteMatch[2]) {
    return revokeRondoInvite(request, env, rondoInviteMatch[1], rondoInviteMatch[2]);
  }
  const rondoInvitesMatch = pathname.match(/^\/api\/rondo\/spaces\/([0-9a-f-]+)\/invites$/u);
  if (request.method === 'POST' && rondoInvitesMatch?.[1]) {
    return createRondoInvite(request, env, rondoInvitesMatch[1]);
  }
  const rondoRoomMatch = pathname.match(
    /^\/api\/rondo\/spaces\/([0-9a-f-]+)\/rooms\/([0-9a-f-]+)$/u,
  );
  const rondoRoomRouteMatch = pathname.match(
    /^\/api\/rondo\/spaces\/([0-9a-f-]+)\/rooms\/([0-9a-f-]+)\/route$/u,
  );
  if (request.method === 'GET' && rondoRoomRouteMatch?.[1] && rondoRoomRouteMatch[2]) {
    return rondoRoomRoute(request, env, rondoRoomRouteMatch[1], rondoRoomRouteMatch[2]);
  }
  if (request.method === 'DELETE' && rondoRoomMatch?.[1] && rondoRoomMatch[2]) {
    return deleteRondoRoom(request, env, rondoRoomMatch[1], rondoRoomMatch[2]);
  }
  const rondoRoomsMatch = pathname.match(/^\/api\/rondo\/spaces\/([0-9a-f-]+)\/rooms$/u);
  if (request.method === 'POST' && rondoRoomsMatch?.[1]) {
    return createRondoRoom(request, env, rondoRoomsMatch[1]);
  }
  const rondoNodeMatch = pathname.match(
    /^\/api\/rondo\/spaces\/([0-9a-f-]+)\/nodes\/([0-9a-f-]+)$/u,
  );
  if (request.method === 'DELETE' && rondoNodeMatch?.[1] && rondoNodeMatch[2]) {
    return removeRondoNode(request, env, rondoNodeMatch[1], rondoNodeMatch[2]);
  }
  const rondoNodesMatch = pathname.match(/^\/api\/rondo\/spaces\/([0-9a-f-]+)\/nodes$/u);
  if (request.method === 'POST' && rondoNodesMatch?.[1]) {
    return addRondoNode(request, env, rondoNodesMatch[1]);
  }
  if (request.method === 'PATCH' && rondoNodesMatch?.[1]) {
    return reorderRondoNodes(request, env, rondoNodesMatch[1]);
  }
  const rondoSpaceMatch = pathname.match(/^\/api\/rondo\/spaces\/([0-9a-f-]+)$/u);
  if (request.method === 'GET' && rondoSpaceMatch?.[1]) {
    return rondoSpaceDetail(request, env, rondoSpaceMatch[1]);
  }
  if (request.method === 'PATCH' && rondoSpaceMatch?.[1]) {
    return updateRondoSpace(request, env, rondoSpaceMatch[1]);
  }
  if (request.method === 'GET' && pathname === '/api/fluo/public-storage') {
    return publicStorageStatus(request, env);
  }
  if (request.method === 'POST' && pathname === '/api/fluo/public-storage/reservations') {
    return reservePublicStorage(request, env);
  }
  const publicReservationMatch = pathname.match(
    /^\/api\/fluo\/public-storage\/reservations\/([0-9a-f-]+)$/u,
  );
  if (request.method === 'PATCH' && publicReservationMatch?.[1]) {
    return commitPublicStorage(request, env, publicReservationMatch[1]);
  }
  if (request.method === 'DELETE' && publicReservationMatch?.[1]) {
    return cancelPublicStorage(request, env, publicReservationMatch[1]);
  }
  const publicPostMatch = pathname.match(
    /^\/api\/fluo\/public-storage\/posts\/([0-9a-f-]+)\/([0-9a-f-]+)$/u,
  );
  if (request.method === 'DELETE' && publicPostMatch?.[1] && publicPostMatch[2]) {
    return releasePublicPost(request, env, publicPostMatch[1], publicPostMatch[2]);
  }
  const nodeRouteMatch = pathname.match(/^\/api\/nodes\/([0-9a-f-]+)\/route$/u);
  if (request.method === 'GET' && nodeRouteMatch?.[1]) {
    return nodeRoute(request, env, nodeRouteMatch[1]);
  }
  const nodeRelayMatch = pathname.match(/^\/api\/nodes\/([0-9a-f-]+)\/relay(\/.*)?$/u);
  if (nodeRelayMatch?.[1]) {
    return relayNodeRequest(request, env, nodeRelayMatch[1], nodeRelayMatch[2] ?? '/v1/health');
  }
  const nodeTestMatch = pathname.match(/^\/api\/nodes\/([0-9a-f-]+)\/test$/u);
  if (request.method === 'POST' && nodeTestMatch?.[1]) {
    return nodeQuickTest(request, env, nodeTestMatch[1]);
  }
  if (request.method === 'PATCH' && nodeTestMatch?.[1]) {
    return completeNodeQuickTest(request, env, nodeTestMatch[1]);
  }
  const nodeAccessMatch = pathname.match(/^\/api\/nodes\/([0-9a-f-]+)\/access$/u);
  if (request.method === 'POST' && nodeAccessMatch?.[1]) {
    return issueNodeAccess(request, env, nodeAccessMatch[1]);
  }
  const nodeSpacesMatch = pathname.match(/^\/api\/nodes\/([0-9a-f-]+)\/spaces$/u);
  if (request.method === 'PATCH' && nodeSpacesMatch?.[1]) {
    return updateNodeSpaces(request, env, nodeSpacesMatch[1]);
  }
  const nodeNameMatch = pathname.match(/^\/api\/nodes\/([0-9a-f-]+)\/name$/u);
  if (request.method === 'PATCH' && nodeNameMatch?.[1]) {
    return renameNode(request, env, nodeNameMatch[1]);
  }
  const nodeMatch = pathname.match(/^\/api\/nodes\/([0-9a-f-]+)$/u);
  if (request.method === 'PATCH' && nodeMatch?.[1]) {
    return updateNodePolicy(request, env, nodeMatch[1]);
  }
  if (request.method === 'DELETE' && nodeMatch?.[1]) {
    return deleteNode(request, env, nodeMatch[1]);
  }

  if (request.method === 'POST' && pathname === '/api/auth/register') {
    return register(request, env, CLIENT_WEB);
  }
  if (request.method === 'POST' && pathname === '/api/auth/login') {
    return login(request, env, CLIENT_WEB);
  }
  if (request.method === 'POST' && pathname === '/api/auth/desktop/register') {
    return register(request, env, CLIENT_DESKTOP);
  }
  if (request.method === 'POST' && pathname === '/api/auth/desktop/login') {
    return login(request, env, CLIENT_DESKTOP);
  }
  if (request.method === 'POST' && pathname === '/api/auth/seed-login') {
    return seedLogin(request, env, CLIENT_WEB);
  }
  if (request.method === 'POST' && pathname === '/api/auth/desktop/seed-login') {
    return seedLogin(request, env, CLIENT_DESKTOP);
  }
  if (request.method === 'POST' && pathname === '/api/auth/logout') {
    return logout(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/auth/sessions') {
    return sessions(request, env);
  }
  const authSessionMatch = pathname.match(/^\/api\/auth\/sessions\/([A-Za-z0-9_-]{43})$/u);
  if (request.method === 'DELETE' && authSessionMatch?.[1]) {
    return terminateSession(request, env, authSessionMatch[1], ctx);
  }
  if (request.method === 'GET' && pathname === '/api/auth/me') {
    return me(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/profile') {
    return getProfile(request, env);
  }
  if (request.method === 'POST' && pathname === '/api/profile/reservations') {
    return reserveProfileStorage(request, env);
  }
  const profileReservationMatch = pathname.match(
    /^\/api\/profile\/reservations\/([0-9a-f-]+)$/u,
  );
  if (request.method === 'PATCH' && profileReservationMatch?.[1]) {
    return commitProfileStorage(request, env, profileReservationMatch[1]);
  }
  if (request.method === 'DELETE' && profileReservationMatch?.[1]) {
    return cancelProfileStorage(request, env, profileReservationMatch[1]);
  }
  if (request.method === 'POST' && pathname === '/api/auth/presence') {
    return presence(request, env);
  }
  if (request.method === 'PATCH' && pathname === '/api/auth/account/username') {
    return changeUsername(request, env);
  }
  if (request.method === 'PATCH' && pathname === '/api/auth/account/password') {
    return changePassword(request, env, ctx);
  }
  if (request.method === 'POST' && pathname === '/api/auth/account/seed') {
    return issueSeed(request, env);
  }

  return json({ error: 'Not found.' }, 404);
}
