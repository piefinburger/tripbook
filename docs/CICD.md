# CI/CD: PR to production

Flow: branch -> PR (CI must pass) -> approve + merge to main -> GitHub
Actions SSHes to the Lightsail instance -> deploy/deploy.sh backs up the
DB, pulls main, rebuilds containers, and gates on /api/health.

Data safety: Postgres lives in the compose named volume `dbdata`, which
`docker compose up -d --build` never touches. Schema changes apply on
container start and are additive/idempotent by convention (CI applies the
schema twice to prove it). Every deploy starts with a pg_dump to
s3://<bucket>/backups/, so the worst case is restore-from-minutes-ago.

## One-time setup (10 minutes)

1. Repo -> Settings -> Branches -> Add branch protection for `main`:
   require a pull request before merging, require 1 approval, require
   status checks to pass (select "build" once CI has run once).
2. Create a deploy SSH keypair for Actions (on your Mac):
   `ssh-keygen -t ed25519 -f lightsail-deploy -N "" -C tripbook-actions`
   Append lightsail-deploy.pub to ~/.ssh/authorized_keys on the instance.
3. Repo -> Settings -> Environments -> New environment `production`.
   Optional: add yourself as a required reviewer for a manual gate on
   every deploy. Add environment secrets:
   - LIGHTSAIL_HOST: the static IP
   - LIGHTSAIL_SSH_KEY: contents of the PRIVATE lightsail-deploy file
   Delete both local key files after pasting.
4. The instance keeps its existing read-only GitHub deploy key; Actions
   never touches GitHub from the server (git fetch uses it).

## Day-to-day
- Agent or human edits on a branch, opens PR. CI: npm build + schema
  double-apply against a throwaway Postgres.
- You review, approve, merge. Deploy runs; ~3-5 min; watch in Actions tab.
- Rollback: `git reset --hard <prev sha> && docker compose up -d --build`
  on the server; restore DB from the pre-deploy dump only if a migration
  actually damaged data (none should; additive-only).

## Manual deploy (bypass, emergencies)
ssh ubuntu@<ip> 'cd ~/tripbook && bash deploy/deploy.sh'
