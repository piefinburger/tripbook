# Tripbook Deployment Runbook

Audience: an engineer with no prior knowledge of these accounts. Follow in
order. Each phase ends with a verification step; do not continue past a
failed verification. Total time: 60 to 90 minutes, plus DNS propagation waits.

## Phase 0: What you need before starting

Request these from the account owner (David):

| Item | Used in phase | Notes |
|---|---|---|
| AWS credentials for account 416369639144 with admin (or IAM+S3+SES+Lightsail) rights | 2, 3, 4 | Configure as a named CLI profile called `personal` |
| Namecheap login with access to the pfeif.us domain | 3 | DNS records are set here, not in AWS |
| GitHub access to github.com/piefinburger (or rights to create the `tripbook` repo there) | 1 | |
| Anthropic API key | 6 | Starts with `sk-ant-` |
| The tripbook source (this repo, from the zip or from GitHub once pushed) | 1 | |
| List of family email addresses | 3 (only if SES stays in sandbox) | |

Local tooling: git, AWS CLI v2, an SSH client. Verify:

```
aws --version        # aws-cli/2.x
git --version
aws configure --profile personal   # enter the provided access key, secret, region us-east-1, output json
aws sts get-caller-identity --profile personal
```

Verification: the last command returns `"Account": "416369639144"`. If it
returns any other account number, STOP and get the right credentials.

## Phase 1: Source control

If the repo does not exist on GitHub yet:

```
cd tripbook            # the unzipped source directory
git init
git add -A
git commit -m "Initial Tripbook"
git branch -M main
git remote add origin git@github.com:piefinburger/tripbook.git
git push -u origin main
```

Verification: https://github.com/piefinburger/tripbook shows README.md,
docker-compose.yml, and a `deploy/` directory. Confirm `.env` is NOT in the
repo (only `.env.example` should be there; `.gitignore` already excludes
`.env`).

## Phase 2: AWS S3 and IAM

From your laptop, inside the repo directory:

```
AWS_PROFILE=personal bash deploy/provision.sh
```

This is idempotent (safe to re-run). It:

1. Creates S3 bucket `tripbook-media-416369639144` (bucket names are global;
   this exact name is hardcoded in the script and in `.env.example`).
2. Blocks all public access on the bucket.
3. Sets CORS allowing PUT/GET from https://tripbook.pfeif.us only.
4. Adds a lifecycle rule expiring `backups/` objects after 14 days.
5. Creates IAM user `tripbook-app` with the minimal policy in
   `deploy/iam-policy.json` (this bucket + SES send, nothing else).
6. Prints an ACCESS KEY ID and SECRET ACCESS KEY on the last line.

**Copy those two values into a password manager entry now.** The secret is
shown once. They go into the server `.env` in Phase 6. Do not reuse David's
personal credentials on the server; the server gets only this scoped user.

Verification:

```
aws s3api get-bucket-cors --bucket tripbook-media-416369639144 --profile personal
aws iam list-access-keys --user-name tripbook-app --profile personal
```

Both succeed; the CORS origin shows tripbook.pfeif.us.

## Phase 3: SES and Namecheap DNS

### 3a. Create the SES domain identity

```
aws sesv2 create-email-identity --email-identity pfeif.us --profile personal --region us-east-1
```

The output contains `DkimAttributes.Tokens` with three strings like
`abc123xyz`. Each one becomes a DNS record. If you lose the output:

```
aws sesv2 get-email-identity --email-identity pfeif.us --profile personal --region us-east-1
```

### 3b. Namecheap DNS records

Log in at namecheap.com, then: Domain List -> pfeif.us -> **Manage** ->
**Advanced DNS** tab. Add the following records with **Add New Record**.

Namecheap quirk that matters: in the Host field, enter names **without**
the `.pfeif.us` suffix. Namecheap appends the domain automatically. Entering
`token1._domainkey.pfeif.us` would create
`token1._domainkey.pfeif.us.pfeif.us` and DKIM will never verify.

| Type | Host | Value | TTL |
|---|---|---|---|
| CNAME | `<token1>._domainkey` | `<token1>.dkim.amazonses.com.` | Automatic |
| CNAME | `<token2>._domainkey` | `<token2>.dkim.amazonses.com.` | Automatic |
| CNAME | `<token3>._domainkey` | `<token3>.dkim.amazonses.com.` | Automatic |
| A | `tripbook` | `<Lightsail static IP, from Phase 4>` | Automatic |

Replace `<tokenN>` with the three DKIM tokens from 3a. The A record can be
added now with a placeholder and edited in Phase 4, or added after Phase 4;
either order works.

Optional but recommended for deliverability (add if pfeif.us has no SPF/DMARC
yet; if a TXT SPF record already exists, merge `include:amazonses.com` into
it rather than adding a second SPF record):

| Type | Host | Value |
|---|---|---|
| TXT | `@` | `v=spf1 include:amazonses.com ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none;` |

### 3c. Wait for DKIM verification

Takes 5 minutes to a few hours. Check:

```
aws sesv2 get-email-identity --email-identity pfeif.us --profile personal --region us-east-1 \
  --query 'DkimAttributes.Status'
```

Verification: status is `SUCCESS`. Do not proceed to sandbox handling until
it is.

### 3d. SES sandbox

New SES accounts can only send to verified addresses. Check:

```
aws sesv2 get-account --profile personal --region us-east-1 --query 'ProductionAccessEnabled'
```

If `false`, pick one:

- **Option A (proper):** AWS console -> Amazon SES -> Account dashboard ->
  Request production access. Use case: "Transactional sign-in links for a
  private family photo journal, ~5 recipients, all opted in." Usually
  approved within 24 hours.
- **Option B (works today):** verify each family address individually:
  `aws sesv2 create-email-identity --email-identity name@example.com --profile personal --region us-east-1`
  Each person must click the confirmation email AWS sends them before magic
  links will deliver to them.

## Phase 4: Lightsail instance

AWS console (region **us-east-1 / N. Virginia**) -> Lightsail -> Create instance:

1. Platform: Linux/Unix. Blueprint: OS Only -> **Ubuntu 24.04 LTS**.
2. Plan: **2 GB RAM / 2 vCPU ($12/mo)**. Do not pick the 1 GB plan; Docker
   builds and PDF rendering will OOM on it.
3. Name: `tripbook`. Create.
4. Networking tab of the instance -> **Create static IP**, attach it to
   `tripbook`. Note the IP.
5. Same Networking tab -> IPv4 Firewall -> confirm SSH (22) exists; **add
   HTTP (80) and HTTPS (443)**.

Now set the DNS A record from Phase 3b: Namecheap Advanced DNS, Type A,
Host `tripbook`, Value = the static IP.

Verification (from your laptop; may take up to 30 minutes for DNS):

```
nslookup tripbook.pfeif.us
```

Returns the static IP.

## Phase 5: Server bootstrap

SSH in. Either use the browser SSH button in Lightsail, or download the
default key from Lightsail -> Account -> SSH keys and:

```
ssh -i LightsailDefaultKey-us-east-1.pem ubuntu@<static-ip>
```

On the instance:

```
git clone https://github.com/piefinburger/tripbook.git ~/tripbook
bash ~/tripbook/deploy/server-setup.sh
```

The script installs Docker Engine + compose plugin, adds `ubuntu` to the
docker group, and copies `.env.example` to `.env`. It is idempotent: safe
to re-run, it skips the clone if `~/tripbook` already exists and never
overwrites an existing `.env`.

Verification: `ls -la ~/tripbook/.env` exists.

Log out and back in (or run `newgrp docker`) so the docker group applies.

Verification: `docker ps` runs without a permission error.

## Phase 6: Environment file

```
cd ~/tripbook
nano .env
```

Fill every line. Generate the two secrets on the instance:

```
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # SETTINGS_SECRET
openssl rand -hex 16   # POSTGRES_PASSWORD
```

| Variable | Value |
|---|---|
| APP_URL | `https://tripbook.pfeif.us` (exactly; no trailing slash) |
| SESSION_SECRET | first openssl output |
| SETTINGS_SECRET | second openssl output (encrypts API keys stored in the app) |
| POSTGRES_PASSWORD | third openssl output |
| AWS_REGION | `us-east-1` |
| S3_BUCKET | `tripbook-media-416369639144` |
| SES_FROM | `Tripbook <tripbook@pfeif.us>` |
| ANTHROPIC_API_KEY | provided key (`sk-ant-...`) |
| AWS_ACCESS_KEY_ID | from Phase 2 (the `tripbook-app` user, NOT anyone's personal key) |
| AWS_SECRET_ACCESS_KEY | from Phase 2 |

Remove the trailing `# comment` text on the lines you fill; some parsers
include trailing comments in values.

Lock it down: `chmod 600 .env`

## Phase 7: Launch

```
cd ~/tripbook
docker compose up -d --build
```

First build takes 3 to 6 minutes. Then:

```
docker compose ps            # caddy, app, db all "running"; db "healthy"
docker compose logs app | tail -20   # expect "schema applied" then "Ready in ..."
docker compose logs caddy | grep -i certificate   # expect a successful obtain for tripbook.pfeif.us
```

If Caddy logs show ACME failures, DNS has not propagated or port 80/443 is
closed; fix and `docker compose restart caddy`.

Install the nightly database backup:

```
(crontab -l 2>/dev/null; echo '15 7 * * * /home/ubuntu/tripbook/deploy/backup.sh >> /home/ubuntu/backup.log 2>&1') | crontab -
```

Test the backup path once, now:

```
bash ~/tripbook/deploy/backup.sh
aws s3 ls s3://tripbook-media-416369639144/backups/ --profile personal   # run from your laptop
```

Verification: one `.sql.gz` object exists under backups/.

## Phase 8: End-to-end acceptance test

Part A is on an iPhone in Safari (not Chrome). Part B is on a laptop in a
full browser, because book editing is designed for the big screen. Both
parts must pass.

### Part A: capture on the phone

1. Open https://tripbook.pfeif.us. Padlock present, no cert warning.
2. Enter an email address (a verified one, if still in the SES sandbox).
   The magic link email arrives within a minute. Tap it; you land on the
   welcome screen. Set a name.
3. Tap Share -> **Add to Home Screen**. Open Tripbook from the home screen
   from now on (this enables offline behavior).
4. Create a trip. Tap **Add photos**, take a photo, allow location. The
   photo appears in the timeline with a place name under it within a few
   seconds. Add at least 6 photos total (needed for Part B).
5. Add a text note. It appears in the feed under today's yellow day tag.
6. Airplane mode on. Add a note and a photo. A yellow "waiting to sync" chip
   appears. Airplane mode off with the app open; the chip clears and both
   items appear.
7. Tap **Invite**, email a second address. That person receives the invite,
   signs in, and sees the shared timeline.
8. Tap **Book** -> **Open editor**. Choose "Auto-narrative" -> **Generate
   draft**. The page updates itself to the editor in under two minutes.
   Confirm the editor is usable one-handed: bottom toolbar shows
   Photos / Assistant / History, and tapping Photos slides a sheet up.

### Part B: edit on the laptop

9. Sign in at https://tripbook.pfeif.us on a laptop (same email, new magic
   link). Open the trip -> **Book** -> **Open editor**. Verify the desktop
   layout: pages in the center, a sticky right sidebar with
   Photos / Assistant / History tabs. This layout is required; if you see
   the phone layout, the browser window is under 1024px wide.
10. Click a page, then click an unused photo in the Photos tab. The photo
    lands on that page and the tray badge flips to "In book". Right-click a
    photo -> it grays out as "Excluded".
11. Edit a caption, switch a page's template, and move a page down. Wait 2
    seconds, hard-refresh the browser. All three changes survived
    (autosave works).
12. In the Assistant tab, type "make the chapter titles shorter" and
    **Apply with AI**. A summary of the change appears and the titles
    update. Open History; at least two revisions exist; click **Restore**
    on the older one and confirm the titles revert.
13. Open **Settings** (link at top of the trips page). Confirm the four
    model rows show Anthropic defaults. Toggle nothing yet; this is a
    visual check that the page loads without errors.
14. Back in the editor: **Preview** shows the cover and pages. Return to
    the Book page, **Export PDF**, wait for "PDF ready", **Download PDF**
    and confirm the PDF opens with full-resolution photos and matches the
    edits you made (caption, page order).

### Part C: gallery

15. On the phone, open the trip -> **Gallery** (topbar). Tap **Upload**
    and multi-select 3 photos from the camera roll taken on an earlier
    date, plus 1 short video. All four upload with a visible counter and
    appear under the day they were TAKEN, not today, each with the
    uploader's initials chip. The video shows a play badge with duration.
16. On the laptop, the second family member opens the same gallery and
    sees all four items with the correct uploader attribution. Tap the
    video: it plays in the lightbox. Tap a photo: **Download original**
    downloads the full-resolution file.
17. In the book editor's Photos tab, the 3 new photos are available and
    one can be placed on a page. The video does NOT appear in the tray.
18. In the gallery, delete one of the photos you uploaded. It disappears
    for both members, and if it was placed in the book, the page updates
    and the editor's History shows a restorable revision.

All eighteen pass = deployment complete.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Magic link email never arrives | SES sandbox + unverified recipient, or DKIM not verified | Phase 3c/3d; check `docker compose logs app` for an SES error |
| Email arrives, link says expired immediately | APP_URL wrong (link points somewhere else) or clock skew | Confirm APP_URL exactly `https://tripbook.pfeif.us`; `docker compose restart app` after editing .env |
| Photo upload fails from phone | S3 CORS origin mismatch | Re-run Phase 2 script; origin must exactly match https://tripbook.pfeif.us |
| Place names never appear | Outbound blocked to nominatim.openstreetmap.org | Non-fatal; entries save without places. Check instance egress |
| Book generation status = Failed with auth error | ANTHROPIC_API_KEY missing/typo | Fix .env, `docker compose up -d`, generate again |
| PDF export stuck in "Making the PDF..." then Failed | Chromium OOM | Confirm the 2 GB plan; `docker compose logs app` for the error; re-run from the Book page |
| Site shows Caddy default page or cert error | A record wrong or ports closed | Phase 4 verification |
| `docker compose` says POSTGRES_PASSWORD must be set | .env missing or empty value | Phase 6 |
| Saving an OpenRouter key in Settings fails with 500 | SETTINGS_SECRET missing from .env | Phase 6; `docker compose up -d` after adding it |
| Editor shows phone layout on a laptop | Browser window narrower than 1024px | Widen the window; the breakpoint is 1024px |
| Book generates instantly with title "Mock Family Book" | LLM_MOCK=1 leaked into the production .env | Delete that line from .env and `docker compose up -d`. LLM_MOCK is for development only and must NEVER be set on the server |
| AI edit returns "The model did not return edits" | Chosen OpenRouter model lacks tool support | Settings -> reset that task to Anthropic, or pick a tools-capable model |
| Library upload lands under today's date instead of when taken | Photo had no EXIF date (screenshots, edited exports) | Expected fallback; the timestamp is editable via the photo's entry, or accept it |
| Library uploads show "No location" | iOS strips location EXIF in the picker by default | In the picker sheet tap Options -> enable Location, or use "Set place" in the lightbox |
| Video will not play on a desktop browser | iPhone HEVC .mov + browser without HEVC decode | Plays in Safari; Chrome needs OS HEVC support. The file itself is fine; Download original works |

## Handoff checklist (give to owner when done)

- [ ] URL of GitHub repo
- [ ] Lightsail static IP
- [ ] Location of the tripbook-app IAM access key (password manager entry)
- [ ] SES status: production access OR list of verified family addresses
- [ ] Confirmation that a backup object exists in s3://.../backups/
- [ ] Confirmation that .env contains SETTINGS_SECRET and does NOT contain LLM_MOCK
- [ ] Date/time of the passed acceptance test (all 18 steps: phone, laptop, gallery)

## Day-2 reference

- Redeploy after code changes: `ssh` in, `bash ~/tripbook/deploy/deploy.sh`
- Logs: `docker compose logs -f app`
- Restore a backup: `gunzip -c dump.sql.gz | docker compose exec -T db psql -U tripbook tripbook`
- Rotate the app's AWS key: `aws iam create-access-key --user-name tripbook-app`,
  update .env, `docker compose up -d`, then delete the old key.
