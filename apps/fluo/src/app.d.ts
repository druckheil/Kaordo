// Augments SvelteKit's app-wide ambient types for Fluo

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			kaordoFluoPost?: string;
			kaordoFluoReturnView?: string;
			kaordoFluoReturnHash?: string;
			kaordoFluoProfileHash?: string;
		}
		// interface Platform {}
	}
}

export {};
