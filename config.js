/* Online backup settings — paste your two Supabase values between the quotes.
   Find them in Supabase: Project Settings → API (or "Connect").
   The key here is the PUBLIC one ("anon" / "publishable"). It is safe to publish:
   the database only lets a signed-in user read or write their own rows.
   Never paste the "service_role" / "secret" key here. */
window.APP_CONFIG = {
  supabaseUrl: 'https://fzzeswpuuobfwkyfpqxd.supabase.co',   // looks like https://abcdefghijk.supabase.co
  supabaseKey: 'sb_publishable_ezDBfhwNq2gBLcwDg3_t8Q_HKYRFqDz',      // long key starting with eyJ… or sb_publishable_…
};
