# Local development

One-time setup, then `npm run dev` forever after.

## 1. Dependencies

```bash
npm install
```

Node 22 matches production (`nvm use 22`). Newer works for dev.

## 2. Database

A throwaway Postgres in Docker. Port 5544 deliberately: 5432 and 5433 are
often taken by a native Postgres on a dev Mac, and a squatter on the port
produces a very confusing "role tripbook does not exist".

```bash
docker run -d --name tripbook-dev-pg -p 5544:5432 \
  -e POSTGRES_USER=tripbook -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=tripbook \
  postgres:16-alpine
```

Afterwards it is just `docker start tripbook-dev-pg`.

## 3. .env.local

Not committed, and must never be: it contains LLM_MOCK, which must never
reach production.

```
DATABASE_URL=postgres://tripbook:dev@127.0.0.1:5544/tripbook
SESSION_SECRET=localdev
SETTINGS_SECRET=localdev
APP_URL=http://localhost:3000
AWS_REGION=us-east-1
S3_BUCKET=fake-local
AWS_ACCESS_KEY_ID=FAKE
AWS_SECRET_ACCESS_KEY=FAKE
LLM_MOCK=1
ADMIN_EMAILS=david.pfeiffenberger@gmail.com
```

Use 127.0.0.1, not localhost: on a Mac, localhost resolves to ::1 first and
Docker publishes on IPv4 only.

## 4. Schema and seed

```bash
export $(grep -v '^#' .env.local | xargs)   # raw node scripts need this; next does not
node db/migrate.mjs                          # "schema applied"
```

Seed a trip worth clicking around in:

```bash
docker exec -i tripbook-dev-pg psql -U tripbook tripbook << 'SQL'
INSERT INTO users (email,name) VALUES ('dev@local','Dad'),('gma@local','Grandma');
INSERT INTO trips (name,owner_id,invite_code) VALUES ('Dev Trip',1,'dev123');
INSERT INTO trip_members (trip_id,user_id,role) VALUES (1,1,'owner'),(1,2,'viewer');
INSERT INTO entries (trip_id,user_id,ts,text,place_name) VALUES
 (1,1,now()-interval '26 hours','Dinner downtown','Paris, France');
INSERT INTO photos (trip_id,user_id,s3_key,preview_key,thumb_key,ts,status,width,height,place_name,lat,lng,entry_id) VALUES
 (1,1,'o/a','p/a','t/a',now()-interval '26 hours','ready',800,600,'Paris, France',48.86,2.35,1),
 (1,1,'o/b','p/b','t/b',now()-interval '5 hours','ready',800,600,'Paris, France',48.86,2.35,NULL),
 (1,1,'o/c','p/c','t/c',now()-interval '3 hours','ready',800,600,'Paris, France',48.86,2.35,NULL),
 (1,1,'o/d','p/d','t/d',now()-interval '1 hour','ready',800,600,'Paris, France',48.86,2.35,NULL);
SQL
```

## 5. Run and sign in

```bash
npm run dev                     # tab 1
npm run dev:login               # tab 2 -> prints a sign-in URL, open it
npm run dev:login -- gma@local  # a viewer session, for permission checks
```

Tokens are single use and last 15 minutes. The script refuses to run against
any database that is not local.

## What is different from production

- **Photos are gray boxes.** S3 credentials are fake, so image requests 403.
  You are testing behavior, layout, and URL shape, not pixels. `.pwrap img`
  carries a min-height so broken images stay tappable.
- **AI is mocked.** LLM_MOCK=1 returns canned responses; book generation
  produces "Mock Family Book" instantly. Never set this on the server.
- **Email fails.** Invites return the SES error in the UI, which is itself
  worth checking: errors must surface, never fail silently.
- **Dev mode is stricter than the production build.** Hydration and effect
  double-invocation surface here and not in prod. That is a feature: a
  runtime error mounts an invisible overlay that eats clicks, so if nothing
  is clickable, open the console before assuming a CSS bug.

## Reset

```bash
docker exec -i tripbook-dev-pg psql -U tripbook -d postgres \
  -c "DROP DATABASE tripbook WITH (FORCE);" -c "CREATE DATABASE tripbook OWNER tripbook;"
node db/migrate.mjs   # then re-run the seed block above
```
