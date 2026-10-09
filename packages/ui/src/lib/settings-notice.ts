// Lets account code flag the settings link without coupling the design system to account behavior
export const settingsNoticeContext = Symbol('settings-notice');

export interface SettingsNotice {
	count: number;
	label: string;
	href: string;
}
export type SettingsNoticeSource = () => SettingsNotice | undefined;
