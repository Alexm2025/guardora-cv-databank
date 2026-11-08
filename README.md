# Guardora — The Guardians CV Databank

Guardora collects every CV that reaches The Guardians into one private, searchable databank:

- **Mailboxes** (`hr@guardiansindia.com` and as many others as you add: jobs@, careers@, Gmail, Zoho, Outlook…): stays
  connected around the clock, imports every CV attachment from past mail, then each new one as soon as it arrives.
- **Website** (`guardiansindia.com`): imports every job application with its CV and the details the applicant typed
  (CTC, expected CTC, notice period, job), plus resumes of registered job seekers.
- **By hand**: drag CV files onto the app, or on Android share a CV from WhatsApp or Gmail straight into Guardora.

It runs on a server, so it keeps collecting while your laptop is off. You open it from a laptop, an Android phone or
an iPhone; it installs like an app.

## What it does with each CV

1. **Reads it.** PDF, Word (.docx and old .doc), RTF, ODT and text. Scanned CVs and photos are kept and marked
   *Needs reading*.
2. **Fills in the profile.** Name, email, phone, date of birth / age, gender, city and state, degrees with year,
   college and marks, skills, work history with dates, total experience, current role, CTC and notice period.
   Anything it gets wrong can be corrected by hand, and corrections are never overwritten by a later CV.
3. **Recognises returning people.** It uses the same email or phone, the same name and date of birth, or a
   near-identical CV. The new CV becomes *version 2* of the same person instead of a duplicate. Uncertain cases
   go to **Duplicates** for you to decide.
4. **Checks for rewritten history.** Each new version is compared with the previous one. It flags a changed date
   of birth or name, a degree year or college that changed, an old job that suddenly appears, changed job dates,
   or experience that grew faster than time passed. The **Versions & changes** tab shows both CVs side by side,
   line by line.
5. **Watches the blacklist.** If a blacklisted person sends a CV again, from any email or number on record, it
   raises a high alert.

## Using it

| Screen | What it is for |
| --- | --- |
| **Overview** | New CVs this week, high-risk alerts, people who came back after being marked done, CVs per day, top skills and cities |
| **Candidates** | Instant search across everything in every CV (names, skills, companies, colleges, phone, email). Filters for age, gender, location, education and degree, skills, experience, status, source, date received and tags. The CV opens beside the list. |
| **Fraud alerts** | Every suspicious change, with severity. Mark each one as checked. |
| **Duplicates** | Possible duplicate records: merge them, or keep them separate |
| **Shortlists** | Candidates you sent to client companies: opened or not, and each company's answer (Interested / Maybe / Not suitable) |
| **Emails** | Write one email to many candidates; each gets their own copy with their name filled in. Send now or schedule it. |
| **Job match** | Paste a client's job description to get people ranked by fit, with matched and missing skills |
| **Sources** | Live status of the mailbox and website feeds, and a log of every file imported or skipped |
| **Settings** | Mailbox, website, team accounts, two-step sign-in, backups, audit log |

On every candidate you can tick **Done**, star and rate them, set a status (New → Reviewing → Shortlisted →
Interview → Placed), **Blacklist** them with a reason, add notes, tag them, email, call or WhatsApp them, merge
or split records, and (owner only) erase all of their data.

**Share with company.** Tick candidates (or open one) and press **Share with company**. Guardora makes a branded
shortlist for the client with each person's professional profile and a cleaned copy of their CV. Phone numbers,
emails, home address, LinkedIn and other links, Aadhaar/PAN, date of birth and family names are always removed,
and names show as "Priya S." or a code (GD-01042). Employer names and current CTC are hidden unless you allow them,
and the original CV files are never sent, so companies have to come through you. Send it as a **PDF** (works
anywhere), or as a **private link** with an optional PIN and an expiry date. On the link, the company answers per
candidate and you see it in Guardora. Links need Guardora to be online on a server; on an office PC, use the PDF.

The **To do**, **Done**, **Came back**, **Flagged**, **Blacklisted** and **Needs reading** tabs are one tap away.
You can save any combination of filters, and export the current list to Excel (CSV).

Keyboard (desktop): `/` search · `j`/`k` next/previous · `d` done · `s` star · `b` blacklist · `1`–`4` tabs · `?` help.

## Run it on this computer (to try it)

Needs [Node.js 22](https://nodejs.org) or newer.

```
npm install
npm start
```

Open http://localhost:8787. On first start the server window shows a **setup code**; enter it to create the
owner account. On Windows you can double-click **Start Guardora.bat** instead.

To try it with made-up CVs first, without touching real data:

```
set DATA_DIR=demo-data            (PowerShell: $env:DATA_DIR="demo-data")
node tools/seed-demo.js 150
npm start
```

## Install on the PC you will use (Windows)

Copy the `Guardora-setup.zip` to that PC (or clone the GitHub repo), unzip it somewhere permanent such as
`C:\Guardora`, and double-click **Install Guardora background.bat**. It installs Node.js if needed, installs
Guardora, makes it start hidden at every Windows sign-in, and puts a **Guardora** icon on the Desktop and in the
Start menu that opens it in its own window (right-click it in the taskbar → Pin to taskbar). Step-by-step:
`INSTALL ON YOUR PC.txt`. To stop it: **Remove Guardora background.bat** (data is kept).

## Connect a mailbox (hr@ and any others)

`guardiansindia.com` mail runs on Google Workspace. Guardora signs in over IMAP with an **app password**, not the
normal password:

1. Sign in as `hr@guardiansindia.com` at myaccount.google.com → Security → turn on **2-Step Verification**.
2. Open **myaccount.google.com/apppasswords**, create one called "Guardora", and copy the 16 letters.
3. In Gmail → Settings → Forwarding and POP/IMAP, make sure **IMAP is enabled**.
4. In Guardora → Settings → Mailboxes → **Add a mailbox**, type the address and paste the app password, press
   **Test connection**, tick *Import CVs* (and *Send email* if you want to email candidates from it) and **Save**.

Add more mailboxes the same way. The same email arriving in two of them is imported once.

The first import goes through all existing mail (oldest first); progress shows under **Sources**. Use
`[Gmail]/All Mail` as the folder to include archived mail. If "App passwords" is missing, the Workspace admin has
to allow 2-Step Verification for the account.

## Area and railway-line search

Guardora reads the locality from each CV's address (Mulund, Bhandup, Vikhroli, Kharghar, Ghodbunder Road, Hinjewadi…)
and knows Mumbai's suburban lines in station order. In Candidates → Location you can pick areas, a whole line
(Western, Central, Harbour, Trans-Harbour, Nerul–Uran, Vasai–Diva–Panvel), or "within 3 stations of Thane".
Localities that are not stations count by their nearest station (Powai → Kanjurmarg). Old spellings work too
(Kanjur Marg, Dombivali, Elphinstone Road, CST/VT).

## Email candidates

Tick candidates → **Email**. Write once with fields like `{{first_name}}`, `{{applied_for}}`, `{{city}}`; attach a JD if
you like; **send now** or **at a chosen time**. Each person gets a separate email (nobody sees the others). People with
no email or on the blacklist are skipped. Emails go out through your own mailbox (Settings → Mailboxes → "Send email
from this mailbox"; for Gmail the same app password works), so replies come back to you and copies appear in its Sent
folder. A daily limit (default 400) keeps Gmail from blocking the account; the rest continue automatically the next day.
Every email sent is recorded in the candidate's history.

## Connect the website

Guardora → Settings → Website: the address (`https://guardiansindia.com`) and a website **admin** account.
It is best to create a separate admin user just for Guardora (website Admin → Users → Add user). Guardora only
reads; it never changes anything on the website.

## Put it online permanently (runs 24/7, open from anywhere)

It needs a server that is always on, with Node.js 22+ and a real disk. Any small Ubuntu VPS works (for example
a Hostinger KVM VPS, about 2 GB RAM). Then:

1. Add a DNS **A record** `cv.guardiansindia.com` → the server's IP address.
2. Copy this folder to the server and run, as root, from the folder:
   ```
   sudo bash deploy/setup-ubuntu.sh cv.guardiansindia.com
   ```
   This installs Node.js, nginx and a free HTTPS certificate, creates a locked-down `guardora` service user,
   generates the **master key** (it prints it once: **save it in a password manager**), and starts Guardora as a
   service that restarts by itself after crashes and reboots.
3. Open `https://cv.guardiansindia.com`, enter the setup code it printed, create the owner account, turn on
   two-step sign-in (Settings → My security), then connect the mailbox and website.

To update later, copy the new version over and run `sudo bash deploy/update.sh`. A `Dockerfile` is included
for container hosts. The data folder must be on a persistent disk; network "bucket" storage is not suitable for
the database.

## Phones and laptops

- **Android / Windows / Mac (Chrome or Edge):** open the address and choose **Install app**. On Android, Guardora
  then appears in the share sheet, so you can share a CV file from WhatsApp or Gmail into it.
- **iPhone / iPad (Safari):** Share → **Add to Home Screen**.
- **Play Store / App Store apps:** `mobile/` contains a Capacitor project that wraps the same app. With Android
  Studio (and Xcode on a Mac for iPhone): `cd mobile && npm install && npx cap add android && npx cap open android`.
  Set `server.url` in `mobile/capacitor.config.json` to your address first.

## Security

- **Encryption at rest:** every CV file is encrypted with AES-256-GCM before it is written to disk, and so are
  the saved mailbox and website passwords, two-step secrets and backups. Each purpose gets its own key, derived
  from one master key. The database (profiles and CV text, needed for fast search) sits on the server's disk;
  keep the server itself locked down (setup-ubuntu.sh does this).
- **Sign-in:** passwords are hashed with scrypt; optional two-step sign-in with any authenticator app; accounts
  lock for 15 minutes after 6 wrong passwords; attempts are rate-limited per IP address. Sessions are
  server-side, with HttpOnly, SameSite=Strict and Secure cookies. You can see and end your other signed-in
  devices.
- **Access:** roles are Owner (everything), Recruiter (all candidate work) and Viewer (read only). Every request
  is checked on the server.
- **Web protections:** strict Content-Security-Policy, HSTS, no framing, same-origin checks on every change,
  `noindex`. Text from CVs and emails is never inserted into the page as HTML. CSV exports neutralise
  spreadsheet formulas.
- **Audit log:** every sign-in, edit, download, export, blacklist and deletion, with who and from where.
- **Backups:** an encrypted backup of the database every night (the newest 30 are kept), downloadable from
  Settings → Backups. To restore: `node tools/restore-backup.js <backup file> restored.db`, stop Guardora,
  replace `data/guardora.db`, start it again.
- **Personal data:** CVs are personal data under India's DPDP Act. The owner can erase everything about a
  person (Candidate → ⋯ → Delete all data) when they ask.

**Keep the master key safe.** Without it, nobody (including you) can open the vault or the backups.

## For developers

```
server/
  index.js          HTTP server, security headers, routes, background workers
  config.js         settings from the environment / .env
  db.js             SQLite schema (FTS5 full-text index) and helpers
  security.js       master key, AES-256-GCM, scrypt, TOTP
  vault.js          encrypted, content-addressed CV file store
  extract/          text from PDF/DOCX/DOC/RTF/ODT, CV field parser, dictionaries (skills, degrees, cities)
  ingest.js         the pipeline: dedupe -> parse -> match person -> version -> fraud flags -> index
  match.js          fingerprints and name similarity for duplicate detection
  fraud.js          comparison of two CV versions
  search.js         filters and full-text search
  sources/          mailbox (IMAP IDLE) and website feeds
  routes/           API
public/             the app (no build step), service worker, manifest, icons
tests/              node --test: pipeline, API security, mailbox helpers
tools/              demo data, icons, backup restore
deploy/             Ubuntu setup, systemd, nginx
mobile/             Capacitor wrapper for store apps
```

`npm test` runs everything against throwaway data folders. After an update that improves CV reading, run
`node tools/reparse-all.js` (with Guardora stopped) to re-read all stored CVs; hand corrections are kept.
