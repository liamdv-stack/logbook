# Setting up Calisthenics Logbook

About 25 minutes, once. You need a computer for parts 1–2 and your phone for part 3.

---

## 1. Put the app on GitHub (about 10 min)

1. Go to **github.com** and create a free account (skip this if you already have one).
2. Click **+** (top right) → **New repository**.
   - Repository name: `logbook`
   - Visibility: **Public**. Free GitHub Pages needs a public repository. Only the app's code is in it,
     never your logs or photos — those live in your private Supabase database.
   - Leave the other boxes unticked → **Create repository**.
3. On the new, empty repository page click the link **uploading an existing file**.
4. Open the **calisthenics-app** folder in your Downloads. Select **everything inside it** (including the
   `icons` and `vendor` folders) and drag it onto the browser window. Chrome handles folder drags best.
5. Wait until every file is listed, then click **Commit changes**.
6. Go to **Settings** (tab at the top of the repository) → **Pages** (left menu).
   - Source: **Deploy from a branch**
   - Branch: **main**, folder **/ (root)** → **Save**
7. After a minute or two, refresh the page. The address appears at the top:
   `https://YOUR-USERNAME.github.io/logbook/` — that's your app. Keep it handy.

## 2. Set up the online backup in Supabase (about 10 min)

1. Go to **supabase.com** → **Start your project**. Signing in with your GitHub account is easiest.
2. **New project**
   - Name: `logbook`
   - Database password: let it generate one and save it in your password manager (the app doesn't need it)
   - Region: **Central EU (Frankfurt)** or **West EU** — closest to the Netherlands
   - Plan: Free → **Create new project**, then wait a couple of minutes while it starts.
3. Left menu → **SQL Editor** → **New query**. Open `supabase-setup.sql` from the folder, copy all of it,
   paste it in and click **Run**. You should see *Success. No rows returned*.
4. Click **Connect** at the top of the dashboard (or **Project Settings → API Keys**) and copy two things:
   - the **Project URL** (looks like `https://abcdefghijk.supabase.co`)
   - the **Publishable key** (`sb_publishable_…`) — or the **anon** key if that's what you see.
     Never use the *secret* or *service_role* key.
5. Back on GitHub, open **config.js** in your repository → click the **pencil** (Edit) → paste the two
   values between the quotes, replacing `PASTE_PROJECT_URL_HERE` and `PASTE_ANON_KEY_HERE` → **Commit changes**.
   GitHub Pages updates itself within a minute or two.
6. In Supabase: **Authentication → URL Configuration** → set **Site URL** to your app address from step 1.7.
   (This makes the confirmation email link point back to your app.)

## 3. Install it on your phone and sign in (about 5 min)

1. On your iPhone, open your app address in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**. The neon dumbbell icon appears.
   (Android: open it in Chrome → **⋮** → **Install app**.)
3. Open the app **from the home-screen icon** → **Settings** → **Online backup**:
   enter your email and a password → **Create my account (first time only)**.
4. Open the confirmation email from Supabase and tap the link. Then go back to the app and tap **Sign in**.
   The status should say **Backed up to your account**.
   The home-screen app has its own login, separate from Safari, so always sign in inside the installed app.
5. Lock the door behind you: in Supabase go to **Authentication → Sign In / Providers** and switch off
   **Allow new users to sign up**. Your own account keeps working; nobody else can create one.

Done. Log a set, then open Supabase → **Table Editor → docs** — you'll see a row appear.

---

## Good to know

- **No signal in the gym?** Keep logging. Everything is saved on the phone first and syncs when you're back online.
- **Free Supabase projects pause after about a week without any use.** Daily use keeps it awake. If it ever
  pauses (say, on holiday), the app keeps working on your phone; open the Supabase dashboard and click
  **Restore project**, and it syncs again.
- **Updates:** when the app changes, upload the changed files to the repository the same way (drag → Commit).
  The app picks up the new version the next time you open it with signal.
- **Backup file:** Settings → *Save a backup file* gives you everything in one file, any time.
