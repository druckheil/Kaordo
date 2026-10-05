// Exports stable API schemas grouped by Kaordo service
import type { components, paths } from './openapi.js';

type Schemas = components['schemas'];

// Identity and shared response types
export type UserIdentity = Schemas['UserIdentity'];
export type ApiError = Schemas['ApiError'];

// Fluo posts and media
export type FluoPost = Schemas['FluoPost'];
export type FluoPostThread = Schemas['FluoPostThread'];
export type FluoQuote = Schemas['FluoQuote'];
export type FluoPage = Schemas['FluoPage'];
export type FluoNewPost = Schemas['FluoNewPost'];
export type FluoDocument = Schemas['FluoDocument'];
export type FluoMedia = Schemas['FluoMedia'];

// Nodo upload metadata
export type NodoUpload = Schemas['NodoUpload'];

// Ligo conversations and messages
export type LigoUser = Schemas['LigoUser'];
export type LigoMedia = Schemas['LigoMedia'];
export type LigoReaction = Schemas['LigoReaction'];
export type LigoMessage = Schemas['LigoMessage'];
export type LigoMessagePage = Schemas['LigoMessagePage'];
export type LigoMessagePreview = Schemas['LigoMessagePreview'];
export type LigoConversation = Schemas['LigoConversation'];
export type LigoConversationPage = Schemas['LigoConversationPage'];
export type LigoUserPage = Schemas['LigoUserPage'];
export type LigoNewConversation = Schemas['LigoNewConversation'];
export type LigoNewMessage = Schemas['LigoNewMessage'];

// Rondo servers, channels and voice access
export type RondoServer = Schemas['RondoServer'];
export type RondoChannel = Schemas['RondoChannel'];
export type RondoDetail = Schemas['RondoDetail'];
export type RondoServerPage = Schemas['RondoServerPage'];
export type RondoNewServer = Schemas['RondoNewServer'];
export type RondoVoiceTicket = Schemas['RondoVoiceTicket'];

// Generated OpenAPI route map
export type { paths };

// Regado administration views
export type {
  AdminSummary,
  AdminUser,
  AdminAuditEntry,
  AdminAccessCase,
  AdminContent,
  AdminContentPage,
  AdminDisk,
  AdminSwapDevice,
  AdminMount,
  AdminOperationProgress, AdminLayoutRequest, AdminStoragePlan, AdminLayoutReport, AdminReplicationReport,
  AdminMediaMaintenance,
  AdminSystem,
  AdminMetrics,
  AdminLogs, AdminJournal, AdminService, AdminLogRetentionDays
} from './admin.js';
