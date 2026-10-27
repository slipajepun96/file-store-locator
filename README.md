# File Store Locator

Track which file box each file is stored in, and print labels for the boxes (3 cm × 20 cm by default, any size you set).
Everyone signs in. Admins manage workers, areas, boxes and labels. Workers register and search files.

**Stack:** React 18 + React Router, Tailwind CSS v4 and [shadcn/ui](https://ui.shadcn.com) components (built with Vite),
an Express API on Node.js, and MySQL 8+ for storage.

| Folder | What's in it |
|---|---|
| `server/` | Express API: `index.js` (routes), `db.js` (MySQL pool, schema, row mapping), `auth.js` (passwords, sessions), `google.js` (Google sign-in), `import-json.js` (one-time import from the old `data.json`) |
| `src/pages/` | One React component per route |
| `src/components/ui/` | shadcn/ui components (add more with `npx shadcn@latest add <name>`) |
| `src/components/` | App components: the page layout and the printable label |
| `src/lib/utils.js` | `cn()` helper for merging Tailwind classes |
| `src/styles.css` | Tailwind import, shadcn theme colours, and the label print styles |

## Sign-in with Google + admin approval

1. A person clicks **Sign in with Google** on the login page.
2. If it's their first time, a **request** is created and they see "waiting for approval". They can't use the app yet.
3. An admin opens **Admin → Workers & Accounts** (the Admin tab shows a count of waiting requests) and clicks
   **Approve**, **Approve as admin** or **Reject**.
4. Once approved, the person signs in with Google again and gets in.

Admins can also **pre-approve** someone by their Google email, so they get straight in on their first sign-in.
**Block** stops an approved account from signing in (and signs them out at once). **Remove** deletes the account; the files they recorded are kept.

### Set up Google sign-in (one time)

1. Go to <https://console.cloud.google.com/>, create (or pick) a project.
2. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and your email, and publish it.
   (While it's in *Testing* mode only the test users you list there can sign in.)
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → type **Web application**.
4. Under **Authorized redirect URIs** add one line per address the app runs on:
   - `http://localhost:5173/api/auth/google/callback` (local dev)
   - `https://YOUR-DOMAIN/api/auth/google/callback` (cloud)
5. Copy the **Client ID** and **Client secret** into `.env` (copy `.env.example` to `.env`):

```bash
GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
ADMIN_EMAIL=you@gmail.com
```

`ADMIN_EMAIL` is the first admin: that Google account is approved as admin automatically on its first sign-in.

## Run locally

You need Node 20.12+ and a MySQL 8+ server. Create an empty database; the app creates its tables on start:

```bash
mysql -u root -p -e "CREATE DATABASE file_store_locator CHARACTER SET utf8mb4"
cp .env.example .env   # fill in MYSQL_* (or DATABASE_URL), plus the Google keys
npm install
npm run dev            # http://localhost:5173  (API on :3001)
```

### Moving from the old `data.json`

Earlier versions kept everything in `server/data.json`. To copy those records into MySQL, run this once against the
empty database, before the first `npm run dev` / `npm start`:

```bash
npm run db:import                 # reads server/data.json (or DATA_DIR/data.json)
npm run db:import path/to/data.json
```

Accounts, areas, boxes, files and label sizes are copied. Sessions are not, so everyone signs in again.

### Fallback password admin

If `ADMIN_EMAIL` is **not** set and there's no admin yet, the server creates an `admin` username/password account
and prints a temporary password in the terminal (or uses `ADMIN_PASSWORD`). It stays available under
"Sign in with username & password" on the login page, as a way back in if Google sign-in is ever misconfigured.

## Host on the cloud

The app is a single Node.js server that serves both the API and the built React app.
Any host that runs Node 20.12+ works, for example Render, Railway or a VPS.

### On a Node web host (Render, Railway…)

Create a **Web Service** from this project and set:

| Setting | Value |
|---|---|
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| MySQL database | a managed MySQL 8+ (the host's add-on, PlanetScale, AWS RDS, …) |
| Env `DATABASE_URL` | e.g. `mysql://user:pass@host:3306/file_store_locator` (or the separate `MYSQL_*` settings) |
| Env `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from Google Cloud (see above) |
| Env `ADMIN_EMAIL` | your Google email (first admin) |
| Env `APP_URL` | optional, e.g. `https://files.example.com`; set it if Google says *redirect_uri_mismatch* |

`PORT` is set by the host automatically. Remember to add the cloud address's callback URL in Google Cloud (step 4 above).

All records live in MySQL, so the app server itself keeps no data and can be redeployed freely.

### On your own server (VPS)

```bash
npm install && npm run build
cp .env.example .env   # fill in the MySQL settings, Google keys and ADMIN_EMAIL
npm start
```

Keep it running with a process manager such as `pm2` or systemd, and put it behind Nginx or Caddy with HTTPS.

### Either way

- Serve it over **HTTPS**. Sign-in cookies are HTTPS-only in production.
- Back up the database regularly, e.g. `mysqldump file_store_locator > backup.sql`.
- Several app instances can share one database. Failed-login throttling is counted per instance.

## Roles

| | Worker | Admin |
|---|---|---|
| Search files, view boxes | ✅ | ✅ |
| Register files | ✅ | ✅ |
| Edit a file (number, name, box) | ✅ | ✅ |
| Remove a file | Only ones they recorded | Any |
| Manage accounts, areas, boxes | | ✅ |
| Print file labels | ✅ | ✅ |
| Print file box labels | | ✅ |

Each file stores file number, file name and file box, plus who recorded it and when (taken from the signed-in account).
Click **Edit** on a search result to change its number, name or box; the last editor and time are saved too.

## Pages

| Route | Purpose |
|---|---|
| `/login` | Sign in |
| `/find` | **Public, no sign-in.** Search by file name and see its box and area (at least 2 characters, up to 25 results) |
| `/` | Search files by file number or file name, see box and area |
| `/files/new` | Key in file number, file name and file box |
| `/boxes/:boxId` | List the files in one box |
| `/account` | Your account (change password for the fallback admin) |
| `/admin` | Accounts, file box areas, file boxes, label printing |
| `/labels?ids=…` | Print preview for one or more file box labels |
| `/labels?files=…` | Print preview for one or more file labels |

## Security notes

- Google sign-in runs on the server (authorization code + PKCE + state check); the client secret never reaches the browser. Only verified Google emails are accepted.
- New Google accounts can't do anything until an admin approves them. Blocking or removing an account ends its sessions immediately.
- Passwords (fallback admin only) are hashed with scrypt. Sessions are random tokens in an HTTP-only, SameSite cookie that lasts 7 days.
- Sign-in is blocked for 15 minutes after 10 failed attempts for the same username from the same IP.
- Resetting or changing a password signs that account out on its other devices.

## Printing labels

- **File box labels** (Admin, or **Print Box Label** on a box) show the area and box name.
  **File labels** show the file name large, with the file number, box and area. Print one with **Label** next to a file,
  or several at once: tick files in search results (ticks stay across searches, the header box ticks every file shown) and click **Print N labels**.
  On a box page, tick some files to print just those, or nothing to **Print All File Labels** in the box.
- **Size:** pick a preset or type any width × height in mm (10–400 mm). Admins can **Save as default**; file labels and box labels keep separate defaults (100 × 50 mm and 30 × 200 mm to start).
  Tall labels (height > width) print the main text vertically for box spines. Wide labels print it horizontally.
  The text scales to fit any size.
- **Paper:** **A4 sheet** prints several labels on one page to cut out. **Label paper** prints one label per page at exactly the chosen size, for label printers.
- **Margin and border:** **Margin** (0–20 mm) is the blank space around each label: on an A4 sheet it spaces the labels apart,
  on label paper it keeps the label that far in from the paper edge (so the printed label is smaller by the margin on each side).
  **Border** draws a thin, thick or dashed line around each label, or none. Both are remembered in your browser.
- In the print dialog, set scale to **100% / Actual size**.
