# Cloud saving (Supabase)

The app keeps its working copy in the browser (IndexedDB). With a Supabase project connected,
everything is also saved to the cloud for the signed-in user and comes back on any computer
where they sign in (`web/js/cloud.js`). Without one, nothing changes: data stays in the browser.

## One-time setup

1. Create a free project at <https://supabase.com> (any name; region Frankfurt or Mumbai).
2. **SQL Editor** → paste `supabase_setup.sql` → Run. It creates the `records` table, the
   private `files` bucket, and the rules that let each user reach only their own data.
3. **Authentication → URL Configuration**
   - Site URL: `https://mohammedallawati.github.io/pv-toolkit/`
   - Redirect URLs: add `https://mohammedallawati.github.io/pv-toolkit/**`
     (and `http://localhost:8000/**` for local testing).
4. **Project Settings → API**: copy the Project URL and the `anon` public key into
   `web/js/cloud_config.js`, then republish the site.
5. Sign in once on the site (Letterhead & backup → Cloud account). Then, while it's just you,
   turn off **Authentication → Sign In / Providers → Allow new users to sign up**, so nobody
   else can create an account.

## How syncing works

- Every record is one row of `records`: `(store, rid)` is the browser store and the record's id,
  `data` the record. Files go to `files/<user id>/<file id>`; their row holds name and type.
- Each change is queued in the browser (`outbox` in `store.js`) and sent within a couple of
  seconds; other devices' changes are fetched at start-up, every minute and when the window
  gets focus. When both sides changed a record, the later `updated_at` wins.
- New records get ids from the clock (`newId` in `store.js`) so two devices don't hand out the
  same id while offline.
- Signing in where data already exists uploads all of it. Restoring a backup uploads the
  restored records, but doesn't delete cloud records the backup doesn't have.

## Sharing with a team later

Add a `workspace_id` column, a `workspace_members` table, and base the row and file rules on
membership instead of `user_id`; the browser side stays the same.
