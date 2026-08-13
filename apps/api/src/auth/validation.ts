import { utf8 } from './encoding';

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9_]{1,30}[a-z0-9])?$/u;
const MAX_REQUEST_BYTES = 4_096;
const PASSWORD_PROOF_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export class InputError extends Error {}

export type Credentials = {
  deviceName: string | null;
  displayUsername: string;
  normalizedUsername: string;
  passwordProof: string;
};

export async function readCredentials(request: Request): Promise<Credentials> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim();
  if (contentType !== 'application/json') {
    throw new InputError('Content-Type must be application/json.');
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) throw new InputError('Request is too large.');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_REQUEST_BYTES) throw new InputError('Request is too large.');

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new InputError('Request body must contain valid JSON.');
  }
  if (
    !isRecord(value) ||
    typeof value.username !== 'string' ||
    typeof value.passwordProof !== 'string'
  ) {
    throw new InputError('Username and password proof are required.');
  }

  let deviceName: string | null = null;
  if (value.deviceName !== undefined) {
    if (typeof value.deviceName !== 'string') {
      throw new InputError('Device name is invalid.');
    }
    deviceName = value.deviceName.trim();
    if (!deviceName || deviceName.length > 80 || utf8(deviceName).byteLength > 160) {
      throw new InputError('Device name is invalid.');
    }
  }

  const displayUsername = value.username.trim();
  const normalizedUsername = displayUsername.toLowerCase();
  if (!USERNAME_PATTERN.test(normalizedUsername)) {
    throw new InputError(
      'Username must be 3–32 characters using letters, numbers, or inner underscores.',
    );
  }
  if (!PASSWORD_PROOF_PATTERN.test(value.passwordProof)) {
    throw new InputError('Password proof is invalid.');
  }
  return {
    deviceName,
    displayUsername,
    normalizedUsername,
    passwordProof: value.passwordProof,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
