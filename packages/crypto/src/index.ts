// Exposes browser-held account keys, device storage and authenticated content encryption
export {
	createAccountKeys,
	wrapAccountKeys,
	unwrapAccountKeys,
	signDeviceTransfer,
	signDeviceRemoval,
	toBase64,
	fromBase64,
	destroyAccountKeys,
	deviceFingerprint,
	sodium
} from './keys.ts';
export type { AccountKeys, KeyPair } from './keys.ts';
export { localDevice, pinAccountKey, pinPeerIdentity } from './device-storage.ts';
export type { LocalDevice } from './device-storage.ts';
export { privateCipher } from './private-data.ts';
export type { Ciphertext, PrivateCipher } from './private-data.ts';
export {
	encryptionSession,
	installEncryptionSession,
	decryptedObjectURL,
	releaseDecryptedURL
} from './session.ts';
export type { EncryptionSession } from './session.ts';

export {
	sealContent,
	openContent,
	isContentEnvelope,
	envelopeText,
	textEnvelope,
	ContentAccessError
} from './content.ts';
export type { ContentEnvelope, PublicIdentity, Audience } from './content.ts';
export {
	isFluoEnvelope,
	fluoEnvelopeText,
	fluoTextEnvelope,
	ownAudienceKey,
	sealAudienceKey,
	openAudienceKey,
	sealKeyring,
	openKeyring,
	sortedRefs
} from './audience.ts';
export type { FluoEnvelope, KeyRef } from './audience.ts';
export {
	encryptMedia,
	decryptMedia,
	mediaDescriptor,
	rememberMedia,
	clearMediaSecrets,
	hasMediaKey
} from './media.ts';
export type { EncryptedMedia } from './media.ts';
export { createRecovery, restoreRecovery, parseRecoveryFile } from './recovery.ts';
export type { RecoveryFile } from './recovery.ts';
export { readResponseBytes } from './bytes.ts';
export { encryptedMediaSchema } from './validation.ts';
