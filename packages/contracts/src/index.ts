// Exports stable API schemas grouped by Kaordo service
import type { components, paths } from './openapi.js';

type Schemas = components['schemas'];

// Identity and shared response types
export type UserIdentity = Schemas['UserIdentity'];
export type UserPresentation = Schemas['UserPresentation'];
export type ApiError = Schemas['ApiError'];

// Fluo posts and media
export type FluoPost = Schemas['FluoPost'];
export type FluoPostThread = Schemas['FluoPostThread'];
export type FluoQuote = Schemas['FluoQuote'];
export type FluoPage = Schemas['FluoPage'];
export type FluoNewPost = Schemas['FluoNewPost'];
export type FluoDocument = Schemas['FluoDocument'];
export type FluoMedia = Schemas['FluoMedia'];
export type FluoNotification = Schemas['FluoNotification'];
export type FluoNotificationPage = Schemas['FluoNotificationPage'];
export type FluoNotificationSummary = Schemas['FluoNotificationSummary'];
export type FluoNotificationReadState = Schemas['FluoNotificationReadState'];
export type FluoNotificationPolicy = Schemas['FluoNotificationPolicy'];
export type FluoNotificationPreferences = Schemas['FluoNotificationPreferences'];
export type FluoPrivacySettings = Schemas['FluoPrivacySettings'];
export type FluoSettings = Schemas['FluoSettings'];
export type FluoSettingsPatch = Schemas['FluoSettingsPatch'];
export type FluoAuthor = Schemas['FluoAuthor'];
export type FluoProfile = Schemas['FluoProfile'];
export type FluoProfileUpdate = Schemas['FluoProfileUpdate'];
export type FluoStatus = Schemas['FluoStatus'];
export type FluoPresence = Schemas['FluoPresence'];
export type FluoConnectionPage = Schemas['FluoConnectionPage'];

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

// Lingvo dictionaries, German learning content and spaced repetition
export type LingvoDictionary = Schemas['LingvoDictionary'];
export type LingvoDictionaryPage = Schemas['LingvoDictionaryPage'];
export type LingvoNewDictionary = Schemas['LingvoNewDictionary'];
export type LingvoSettings = Schemas['LingvoSettings'];
export type LingvoFolder = Schemas['LingvoFolder'];
export type LingvoCardContent = Schemas['LingvoCardContent'];
export type LingvoSchedule = Schemas['LingvoSchedule'];
export type LingvoCard = Schemas['LingvoCard'];
export type LingvoNewCard = Schemas['LingvoNewCard'];
export type LingvoCardUpdate = Schemas['LingvoCardUpdate'];
export type LingvoCardPage = Schemas['LingvoCardPage'];
export type LingvoStudyPage = Schemas['LingvoStudyPage'];
export type LingvoCounts = Schemas['LingvoCounts'];
export type LingvoActivity = Schemas['LingvoActivity'];
export type LingvoOverview = Schemas['LingvoOverview'];
export type LingvoReview = Schemas['LingvoReview'];
export type LingvoReviewResult = Schemas['LingvoReviewResult'];
export type LingvoImport = Schemas['LingvoImport'];
export type LingvoImportResult = Schemas['LingvoImportResult'];
export type LingvoCatalogCard = Schemas['LingvoCatalogCard'];
export type LingvoCatalogSet = Schemas['LingvoCatalogSet'];
export type LingvoCatalog = Schemas['LingvoCatalog'];

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
