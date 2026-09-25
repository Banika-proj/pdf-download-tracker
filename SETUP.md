# The Desk — setup (GitHub + Cloudflare Pages + D1)

No Firebase, no separate server — the whole thing (site + shared database)
runs on Cloudflare's free tier, deployed straight from your GitHub repo.

## What's in this folder
```
index.html              the app shell
styles.css               all styling
app.js                    all app logic (talks to /api/*)
functions/api/[[path]].js  the backend — a Cloudflare Pages Function
schema.sql                the database schema
wrangler.toml              config (used for local dev + D1 binding)
```

## 1. Push this to GitHub
Create a new repo (e.g. `pdf-download-tracker`) and push these files to it —
either via the GitHub website's "upload files", GitHub Desktop, or:
```
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_ORG/pdf-download-tracker.git
git push -u origin main
```

## 2. Create the D1 database
You can do this from the Cloudflare dashboard, or from the command line with
[wrangler](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`, then `wrangler login`):

```
wrangler d1 create desk-db
```
This prints a `database_id` — copy it into `wrangler.toml` in place of
`PASTE_YOUR_D1_DATABASE_ID_HERE`, then load the schema:
```
wrangler d1 execute desk-db --file=./schema.sql --remote
```

(Dashboard alternative: Cloudflare dashboard → Storage & Databases → D1 →
Create database → name it `desk-db` → open its Console tab → paste the
contents of `schema.sql` → Execute.)

## 3. Create the Pages project and connect it to GitHub
Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
**Connect to Git** → pick your repo.
- Build command: *(leave blank — there's nothing to build)*
- Build output directory: `/`
Click **Save and Deploy**.

## 4. Bind the D1 database to the Pages project
Your Pages project → **Settings** → **Functions** → **D1 database bindings**
→ **Add binding**:
- Variable name: `DB`   ← must be exactly this, it's what the code expects
- D1 database: `desk-db`

Redeploy (Settings changes need a new deployment to take effect — trigger one
from the **Deployments** tab, "Retry deployment", or just push a commit).

## 5. Open it
Your app is now live at `https://pdf-download-tracker-xyz.pages.dev` (or a
custom domain if you attach one under **Custom domains**). Share that link
with your vendor(s) — whoever opens it first will trigger the one-time seed
of the 84 sample publications into the shared database.

## How data sharing works
Everyone who opens the link — owner or vendor, any device — reads and writes
the same D1 database through the `/api/*` endpoints. Changes made by one
person show up for everyone else within about 8 seconds (the app polls for
updates; your own actions update instantly).

## About "security later"
Right now, anyone with the link can view and edit everything — there's no
login check, just a name field for attribution. That's fine while you're
piloting this with a small trusted group. Two easy upgrades when you're
ready:
- **Cloudflare Access** (dashboard → Zero Trust → Access) puts an email-based
  login wall in front of the whole site, with zero code changes — good first
  step.
- Real per-user accounts with roles (e.g. vendors only see their own
  publications) would mean adding an auth layer and passing a user token to
  the API — happy to build that when you're ready.

## A note on scale
`GET /api/state` currently returns *all* logs ever recorded, every time. For
84 publications that's fine for at least a couple of years of daily use. If
the logs table gets very large later, the fix is to add a date-range
parameter to that endpoint — flag it and we'll add it.
