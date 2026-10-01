// Keep the local launcher and disposable database test on the same schema.
export const fluoMigrations = [
  '002_fluo.sql',
  '003_reusable_fluo_media.sql',
  '004_fluo_saved_posts.sql',
  '005_fluo_media_retirement.sql',
  '006_fluo_search.sql'
];
