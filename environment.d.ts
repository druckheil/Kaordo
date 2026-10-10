// Declares public build-time endpoints shared by the static applications
declare global {
	interface ImportMetaEnv {
		readonly VITE_KAORDO_API_URL: string;
		readonly VITE_KAORDO_NODO_URL: string;
		readonly VITE_KAORDO_AUTH_URL: string;
		readonly VITE_KAORDO_AUTH_REALM: string;
		readonly VITE_KAORDO_AUTH_CLIENT_ID: string;
	}
}

export {};
