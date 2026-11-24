# DMS Simulator

Web simulator of a French multi-site car dealer group's Dealer Management System: new and used car sales, workshop, parts, accounting and admin. Built for demos, training and workflow testing. Architecture and decisions are in [`docs/`](docs/ARCHITECTURE.md); working notes for contributors are in [`CLAUDE.md`](CLAUDE.md).

## Run locally

Needs Node 24 and PostgreSQL 17.

```bash
cp .env.example .env          # set DATABASE_URL to your local dms_dev database
npm ci
npm run db:reset              # migrate and seed six months of history (~200 s)
npm run dev                   # http://localhost:3000
```

With `DEMO_MODE=true` the login page offers one-click sign-in for every role. All demo users' password is `demo1234`.

## Host a free demo on Hugging Face Spaces

The `Dockerfile` builds one self-contained image: Postgres 17 and the production server, with the demo database seeded while the image is built. Each start begins from that seeded state (D-085).

1. On huggingface.co, create a **Space** with SDK **Docker**, hardware **CPU basic (free)**, visibility **Public**.
2. In the Space's **Settings → Variables and secrets**, add:
   - secret `AUTH_SECRET`: the output of `openssl rand -base64 32`
   - secret `SITE_PASSWORD`: the shared password your visitors will type
   - variable `DEMO_MODE`: `true`
3. Install git-lfs once (`brew install git-lfs`; the favicon is a binary file), then deploy:

   ```bash
   scripts/deploy-hf.sh <hf-user>/<space-name>
   ```

   Git asks for your Hugging Face username and an access token with write permission the first time. The build takes about 10 minutes.
4. Share the direct address `https://<hf-user>-<space-name>.hf.space` and the site password. Do not share the huggingface.co page: it shows the app in a frame, where browsers block the login cookie.

Good to know:
- Everyone shares one database and one business clock. A simulation run moves the date for everybody.
- The Space sleeps after about 48 hours without visits. Waking it up or restarting it resets the data to the seeded demo. Rebuilding it (a new deploy, or **Factory rebuild**) reseeds with today's date.
- The same image runs on any Docker host: `docker build -t dms-demo .` then `docker run -p 7860:7860 -e AUTH_SECRET=… -e DEMO_MODE=true -e SITE_PASSWORD=… dms-demo`.
