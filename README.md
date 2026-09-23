# Calisthenics Logbook

A phone app (installable web app) for a 16-week calisthenics program: day-by-day workouts with automatic
progression, check-ins with progress photos, rest-day yoga, a Mind journal with timed mind-power exercises,
and progress charts. Works offline; backs up to Supabase when you're signed in.

Set-up steps are in **SETUP.md**.

| File | What it is |
|---|---|
| `index.html` | The app page and its styling |
| `program.js` | The 16-week program (exercises, warm-ups, yoga, phases) |
| `app.js` | Workout logging, progression, check-ins, progress, settings, sync |
| `mind.js` | The Mind tab |
| `config.js` | Your Supabase URL and public key |
| `sw.js`, `manifest.webmanifest`, `icons/` | What makes it installable and work offline |
| `vendor/supabase.js` | Supabase's browser library (v2.117.0), kept here so the app works offline |
| `supabase-setup.sql` | Run once in Supabase to create the database table and photo bucket |
