# File Store Locator

Track which file box each file is stored in, and print labels for the boxes (3 cm × 20 cm by default, any size you set).
Everyone signs in. Files are kept per **office**: each office has its own areas, file boxes and files.
Admins manage every office; office admins manage their own office's areas, boxes and workers. Workers register and search files in any office.

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
3. An admin opens **Settings → Workers & Accounts** (the Settings tab shows a count of waiting requests) and clicks
   **Approve**, **As office admin**, **As admin** or **Reject**, after choosing the office the person belongs to.
   An office admin can approve a request too; the person becomes a worker of that office admin's office.
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

## Offices

Everything is organised as **Office → Area → File box → File**.

- Admins add, rename and remove offices under **Settings → Offices**. An office that still has areas or letters can't be removed.
- The office picker in the header (**All offices** or one office) filters the Files page (both the register form's boxes and the search) the Letters page and Settings. It's remembered in the browser and starts at your home office.
- Area names only need to be unique within an office. **File box names and file numbers are unique across all offices.**
- A file can be moved to a box in any office with **Edit**.
- The public `/find` page searches every office and shows each file's office.
- Upgrading an existing database: on first start, the server creates a **Main office** and moves all existing areas (with their boxes and files) into it. Rename it under Settings → Offices.

## Roles

| | Worker | Office admin | Admin |
|---|---|---|---|
| Search files, view boxes (all offices) | ✅ | ✅ | ✅ |
| Register files (any office) | ✅ | ✅ | ✅ |
| Edit a file (number, name, box) | ✅ | ✅ | ✅ |
| Remove a file | Only ones they recorded | Their office's, and ones they recorded | Any |
| Manage areas and file boxes | | Their office | All offices |
| Approve sign-up requests | | As workers of their office | ✅ |
| Block, rename, remove accounts | | Their office's workers | ✅ |
| Manage offices, roles, label default sizes, reset passwords | | | ✅ |
| Print file labels | ✅ | ✅ | ✅ |
| Print file box labels | | ✅ | ✅ |
| Record inbound and outbound letters, assign files, update status and department | ✅ | ✅ | ✅ |
| Remove a letter | Only ones they recorded | Their office's, and ones they recorded | Any |
| Manage letter statuses and departments | | | ✅ |

Each account can have a home office (set by an admin in Workers & Accounts). An office admin must have one.

Each file stores file number, file name and file box, plus who recorded it and when (taken from the signed-in account).
Click **Edit** on a search result to change its number, name or box; the last editor and time are saved too.

## Letters

The **Letters** menu has a tab each for **Inbound** and **Outbound** letters.

- **Record Inbound Letter** asks for the office that received it, the date received, who it's from and the subject.
  **Record Outbound Letter** asks for the office that sent it, who it's to and the subject; the date sent can stay blank
  while the letter is still a draft. Both take an optional reference number, letter date and notes, a status and
  department, and the files the letter is filed in. A letter's direction is set when it's recorded.
- Open a letter to **update its status or department**, with an optional note. Every update is kept in the letter's **history**
  (status, department, note, who and when). **Edit** changes the details (including the date sent) and the assigned files.
- Search by sender or recipient, subject, reference or the number of an assigned file, and filter by status, department
  (or unassigned) and the office picked in the header.
- Admins set the **Letter Statuses** under Settings, with a tab for inbound and one for outbound (in order; new letters
  start at the first). A new database starts with Received, In progress, Replied, Closed (inbound) and Draft, Awaiting
  approval, Sent (outbound). **Departments** are shared by both. A status or department still in use can't be removed.
- Upgrading from the version without outbound letters: on first start, existing letters and statuses become inbound.

### Letter text (scan to search)

**Scan photo / PDF** in the letter form takes photos of the letter's pages (on a phone it offers the camera, or pick
from the gallery) or PDFs. The server reads the text from photos with [Tesseract](https://github.com/naptha/tesseract.js) in Malay and English
and puts it in the **Letter text** box, where it can be corrected before saving. Scanning again adds more pages.
Letters can then be searched by what they say: search results show the matching part of the text, highlighted.

- **Photos are never kept.** Each photo is shrunk on the phone, sent to the server, read in memory and dropped. It is
  never written to disk or stored in the database; only the text is saved, with the letter.
- **PDFs are read in the browser** with [PDF.js](https://mozilla.github.io/pdf.js/) and never uploaded. A page that
  already has text (a PDF made on a computer) gives it directly: instant and exact. A page that's only a picture
  (a scanned PDF) is sent as an image and read like a photo. Up to 30 pages per PDF; it says so if there were more.
  PDF.js is only downloaded the first time someone picks a PDF. Password-protected PDFs must be saved without the
  password first.
- Text is read on this server, so letters never go to an outside service. The language data comes with the
  `@tesseract.js-data` packages (nothing is downloaded while running).
- The first scan after the server starts takes a few seconds longer while the reader loads. Allow about 200 MB of
  extra memory for it. Clear, flat photos in good light read best; handwriting reads poorly.

### Letter numbers

Every letter filed in a file gets a number there: the file number, then **/Bil. (n)**, e.g. `KPM/300/Bil. (24)`.

- Each file keeps a **letter running number**: the last letter number used in it. When you register a file, enter the
  number it's already up to (blank means 0); the next letter filed in it gets one more. Edit the file to correct it,
  though never below a number a letter already has.
- Numbers run on across inbound and outbound letters alike, and are given automatically when the letter is saved
  (the form shows the number it's about to get). A letter in several files has a number in each.
- Numbers aren't reused: removing a letter, or taking it out of a file, leaves a gap. Two letters saved at the same
  moment never get the same number.
- Codes always use the file's current number, so renaming a file renames its letters' codes.
- Letters can be searched by their full code.
- Upgrading from the version without letter numbers: on first start, letters already in a file are numbered 1, 2, 3…
  in the order they were recorded, and each file's running number is set to its last one.

## Settings

**Settings** (admins and office admins) has a section menu on the left (a row of tabs on phones): Workers & Accounts,
Offices, Areas & File Boxes, Letter Statuses and Departments. Office admins see only Workers & Accounts and Areas & File Boxes.

## Pages

| Route | Purpose |
|---|---|
| `/login` | Sign in |
| `/find` | **Public, no sign-in.** Search by file name across all offices and see its office, box and area (at least 2 characters, up to 25 results) |
| `/` | **Files:** search files by number or name and see their office, box and area. **Register File** above the table opens a dialog to add a file |
| `/boxes/:boxId` | List the files in one box |
| `/letters` | Letters, with Inbound and Outbound tabs (`?type=outbound`): search, filter, record a letter |
| `/letters/:letterId` | One letter: details, files, status/department update and history |
| `/account` | Your account (change password for the fallback admin) |
| `/settings/:section` | Settings (admins and office admins): accounts, offices, areas & boxes, letter statuses, departments. `/admin` redirects here |
| `/labels?ids=…` | Print preview for one or more file box labels |
| `/labels?files=…` | Print preview for one or more file labels |

## Security notes

- Google sign-in runs on the server (authorization code + PKCE + state check); the client secret never reaches the browser. Only verified Google emails are accepted.
- New Google accounts can't do anything until an admin approves them. Blocking or removing an account ends its sessions immediately.
- Passwords (fallback admin only) are hashed with scrypt. Sessions are random tokens in an HTTP-only, SameSite cookie that lasts 7 days.
- Sign-in is blocked for 15 minutes after 10 failed attempts for the same username from the same IP.
- Resetting or changing a password signs that account out on its other devices.

## Printing labels

- **File box labels** (Settings → Areas & File Boxes, or **Print Box Label** on a box) show the area and box name, with the office in the footer.
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
