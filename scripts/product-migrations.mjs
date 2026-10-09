// Shares product migrations between local development and disposable database integration
export const productMigrations = [
	'002_fluo.sql',
	'003_reusable_fluo_media.sql',
	'004_fluo_saved_posts.sql',
	'005_fluo_media_retirement.sql',
	'006_fluo_search.sql',
	'007_ligo.sql',
	'008_ligo_self.sql',
	'009_ligo_message_actions.sql',
	'010_rondo.sql',
	'011_regado.sql',
	'012_fluo_quote_tombstones.sql',
	'013_fluo_saved_post_counts.sql',
	'014_fluo_notifications.sql',
	'015_fluo_settings.sql',
	'018_fluo_profiles.sql',
	'019_profile_media_claims.sql',
	'020_end_to_end_encryption.sql'
];
