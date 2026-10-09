// Exports stable API schemas grouped by Kaordo service
import type { components, paths } from './openapi.js';

type Schemas = components['schemas'];

// Identity and shared response types
export type UserIdentity = Schemas['UserIdentity'];
export type UserPresentation = Schemas['UserPresentation'];
export type ApiError = Schemas['ApiError'];

// Fluo posts and media
// Wire posts carry encrypted envelopes and opaque attachments; presentation types hold what the device opened
export type FluoWirePost = Schemas['FluoPost'];
export type FluoMedia = Omit<Schemas['FluoMedia'], 'kind'> & { kind: 'image' | 'video' };
export type FluoWireQuote = Schemas['FluoQuote'];
export type FluoQuote = Omit<FluoWireQuote, 'media'> & { media: FluoMedia[] };
export type FluoPost = Omit<FluoWirePost, 'content' | 'media' | 'quote'> & {
	content: FluoDocument;
	media: FluoMedia[];
	quote: FluoQuote | null;
};
export type FluoPostThread = Omit<Schemas['FluoPostThread'], 'posts'> & { posts: FluoPost[] };
export type FluoPage = Omit<Schemas['FluoPage'], 'items'> & { items: FluoPost[] };
export type FluoNewPost = Omit<Schemas['FluoNewPost'], 'content'> & { content: FluoDocument };
export type FluoDocument = Schemas['FluoDocument'];
export type FluoWireNotification = Schemas['FluoNotification'];
export type FluoNotification = Omit<FluoWireNotification, 'post'> & {
	post: (Omit<NonNullable<FluoWireNotification['post']>, 'media'> & { media: FluoMedia[] }) | null;
};
export type FluoNotificationPage = Omit<Schemas['FluoNotificationPage'], 'items'> & {
	items: FluoNotification[];
};
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

// Device-held encryption identities and opaque diary records
export type EncryptionIdentity = Schemas['EncryptionIdentity'];
export type EncryptionDevice = Schemas['EncryptionDevice'];
export type EncryptionRegistration = Schemas['EncryptionRegistration'];
export type EncryptionApproval = Schemas['EncryptionApproval'];
export type EncryptedEnvelope = Schemas['EncryptedEnvelope'];
export type MemoroDay = Schemas['MemoroDay'];
export type MemoroDayUpdate = Schemas['MemoroDayUpdate'];
export type MemoroSummary = Schemas['MemoroSummary'];

// Generated OpenAPI route map
export type { paths };
export { documentSchema, documentPlainText } from './document.ts';

// Regado administration views
export type {
	AdminSummary,
	AdminUser,
	AdminAuditEntry,
	AdminSwapDevice,
	AdminMediaMaintenance,
	AdminSystem,
	AdminMetrics,
	AdminLogs,
	AdminJournal,
	AdminService,
	AdminLogRetentionDays,
	HostFacts,
	HostDevice,
	HostDeviceHealth,
	HostPool,
	HostPoolMember,
	HostState,
	HostPoolPlan,
	HostPoolStep,
	HostOperation,
	HostOperationRecord,
	HostOperationStage,
	HostStateChange,
	HostCheckRequest,
	HostStateChangeResult
} from './admin.js';
