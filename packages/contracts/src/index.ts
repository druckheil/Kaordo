import type { components, paths } from './openapi.js';

export type UserIdentity = components['schemas']['UserIdentity'];
export type ApiError = components['schemas']['ApiError'];
export type FluoPost = components['schemas']['FluoPost'];
export type FluoQuote = components['schemas']['FluoQuote'];
export type FluoPage = components['schemas']['FluoPage'];
export type FluoNewPost = components['schemas']['FluoNewPost'];
export type FluoDocument = components['schemas']['FluoDocument'];
export type FluoMedia = components['schemas']['FluoMedia'];
export type NodoUpload = components['schemas']['NodoUpload'];
export type LigoUser = components['schemas']['LigoUser'];
export type LigoMedia = components['schemas']['LigoMedia'];
export type LigoReaction = components['schemas']['LigoReaction'];
export type LigoMessage = components['schemas']['LigoMessage'];
export type LigoMessagePage = components['schemas']['LigoMessagePage'];
export type LigoMessagePreview = components['schemas']['LigoMessagePreview'];
export type LigoConversation = components['schemas']['LigoConversation'];
export type LigoConversationPage = components['schemas']['LigoConversationPage'];
export type LigoUserPage = components['schemas']['LigoUserPage'];
export type LigoNewConversation = components['schemas']['LigoNewConversation'];
export type LigoNewMessage = components['schemas']['LigoNewMessage'];
export type RondoServer = components['schemas']['RondoServer'];
export type RondoChannel = components['schemas']['RondoChannel'];
export type RondoDetail = components['schemas']['RondoDetail'];
export type RondoServerPage = components['schemas']['RondoServerPage'];
export type RondoNewServer = components['schemas']['RondoNewServer'];
export type RondoVoiceTicket = components['schemas']['RondoVoiceTicket'];
export type { paths };
export type {
  AdminSummary, AdminUser, AdminAuditEntry, AdminAccessCase, AdminContent, AdminContentPage,
  AdminDisk, AdminSystem, AdminMetrics, AdminLogs
} from './admin.js';
