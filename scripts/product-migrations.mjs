// Keep the local launcher and disposable database test on the same schema.
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
  '013_fluo_saved_post_counts.sql'
];
