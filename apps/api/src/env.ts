type OptionalSecret =
  | 'CLOUDFLARE_ACCOUNT_ID'
  | 'CLOUDFLARE_ACCOUNT_TOKEN'
  | 'R2_ACCESS_KEY_ID'
  | 'R2_S3_ENDPOINT'
  | 'R2_SECRET_ACCESS_KEY'
  | 'SUPERADMIN_USER_ID'
  | 'TURN_KEY_API_TOKEN'
  | 'TURN_KEY_ID';

/** Generated bindings, with secrets optional only so local development can report missing setup. */
export interface Env extends Omit<__BaseEnv_Env, OptionalSecret> {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ACCOUNT_TOKEN?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_S3_ENDPOINT?: string;
  R2_SECRET_ACCESS_KEY?: string;
  SUPERADMIN_USER_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  TURN_KEY_ID?: string;
}
