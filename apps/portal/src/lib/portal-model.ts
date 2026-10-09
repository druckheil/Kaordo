// Defines portal copy, identity routes, and small state helpers

import type { AccountPreview } from '@kaordo/account-ui';
import type { UserIdentity } from '@kaordo/contracts';

export type AuthMode = 'login' | 'register';

type AuthModeCopy = {
	pageTitle: string;
	accessibleName: string;
	actionLabel: string;
	openingMessage: string;
	failureMessage: string;
	otherModePrompt: string;
	otherModeLabel: string;
	otherModePath: string;
};

export const authModeCopy = {
	login: {
		pageTitle: 'Sign in | Kaordo',
		accessibleName: 'Sign in',
		actionLabel: 'Sign in',
		openingMessage: 'Opening your sign-in form…',
		failureMessage: 'Could not open the sign-in form',
		otherModePrompt: 'New to Kaordo?',
		otherModeLabel: 'Create an account',
		otherModePath: '/register/'
	},
	register: {
		pageTitle: 'Create account | Kaordo',
		accessibleName: 'Create account',
		actionLabel: 'Create account',
		openingMessage: 'Opening your registration form…',
		failureMessage: 'Could not open the registration form',
		otherModePrompt: 'Already have an account?',
		otherModeLabel: 'Sign in',
		otherModePath: '/login/'
	}
} as const satisfies Record<AuthMode, AuthModeCopy>;

export function resolveIdentityReturnPath(
	next: string | null,
	validPaths: readonly string[],
	fallback: string
): string {
	return next && validPaths.includes(next) ? next : fallback;
}

export function portalWelcomeMessage(
	loading: boolean,
	user: UserIdentity | null,
	accountPreview: AccountPreview | null
): 'preview' | 'checking' | 'welcome' | 'signed-out' {
	if (loading) return accountPreview ? 'preview' : 'checking';
	return user ? 'welcome' : 'signed-out';
}
