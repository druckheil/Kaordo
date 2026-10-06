// Defines the Rondo settings return location in router-owned history
// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			rondoSettingsReturn?: string;
		}
		// interface Platform {}
	}
}

export {};
