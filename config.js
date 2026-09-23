/* Online backup settings — paste your two Supabase values between the quotes.
   Find them in Supabase: Project Settings → API (or "Connect").
   The key here is the PUBLIC one ("anon" / "publishable"). It is safe to publish:
   the database only lets a signed-in user read or write their own rows.
   Never paste the "service_role" / "secret" key here. */
window.APP_CONFIG = {
  supabaseUrl: 'PASTE_PROJECT_URL_HERE',   // looks like https://abcdefghijk.supabase.co
  supabaseKey: 'PASTE_ANON_KEY_HERE',      // long key starting with eyJ… or sb_publishable_…
};
