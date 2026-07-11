# Tripbook

Family vacation scrapbook PWA. Shared geo-tagged photo and note timeline,
AI-generated print-ready book PDF at trip's end. iOS Safari, installed via
Add to Home Screen. See docs/ARCHITECTURE.md for design and Safari caveats.

## Deploy runbook (once, ~30 minutes)

### 1. AWS (from your laptop, AWS_PROFILE=personal)

```
bash deploy/provision.sh
```

Creates the S3 bucket (private, CORS for tripbook.pfeif.us, 14-day backup
lifecycle) and the tripbook-app IAM user, and prints its access key. Then SES,
one time:

```
aws sesv2 create-email-identity --email-identity pfeif.us
```

Add the three DKIM CNAMEs it returns to pfeif.us DNS. If the account is still
in the SES sandbox, request production access in the SES console; magic links
to unverified family addresses will not deliver until then.

### 2. Lightsail instance

Create: Ubuntu 24.04, 2 GB RAM plan ($12/mo; the 1 GB plan will OOM during
Docker builds and PDF renders). Attach a static IP. Open ports 80 and 443 in
the Lightsail firewall (22 is open by default).

DNS: A record `tripbook.pfeif.us -> <static IP>`.

### 3. On the instance

```
curl -fsSL https://raw.githubusercontent.com/piefinburger/tripbook/main/deploy/server-setup.sh | bash
```

(or clone and run deploy/server-setup.sh). Then:

```
cd ~/tripbook
nano .env        # fill every value; secrets per comments
newgrp docker
docker compose up -d --build
```

Caddy obtains the Let's Encrypt cert automatically once DNS resolves. Install
the backup cron:

```
(crontab -l 2>/dev/null; echo '15 7 * * * /home/ubuntu/tripbook/deploy/backup.sh >> /home/ubuntu/backup.log 2>&1') | crontab -
```

### 4. Smoke test

1. Visit https://tripbook.pfeif.us, sign in with your email, set your name.
2. Create a trip, add a photo and a note, confirm place names appear.
3. Invite a second address (or share the /join link), confirm the invite
   email lands and the member sees the shared timeline.
4. Airplane mode: add a note and photo, confirm the yellow sync chip, go back
   online with the app open, confirm they sync.
5. Book page: Generate (auto), Preview, Export PDF, Download.

## Day-2 operations

- Redeploy after changes: `bash deploy/deploy.sh` on the instance.
- Logs: `docker compose logs -f app`
- Restore a backup: `gunzip -c dump.sql.gz | docker compose exec -T db psql -U tripbook tripbook`
- Re-run a failed book generation or export from the Book page; every attempt
  is a new row with visible status and error.

## Local dev

```
npm install
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=dev -e POSTGRES_USER=tripbook -e POSTGRES_DB=tripbook postgres:16-alpine
DATABASE_URL=postgres://tripbook:dev@localhost:5432/tripbook npm run migrate
npm run dev
```

Set AWS and Anthropic env vars in .env.local for photo upload and book
generation; auth links print to the server log if SES is unconfigured only in
the sense that the SES call will fail, so for local testing verify your own
address in SES sandbox or read the token from the login_tokens table.
