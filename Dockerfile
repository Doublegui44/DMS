# Self-contained demo image (D-085): Postgres 17 and the Next.js production server in one
# container, with the database seeded while the image is built. Every start (or Hugging Face
# Spaces wake-up) begins from that seeded state; nothing written at run time survives a restart.
#
#   docker build -t dms-demo .
#   docker run -p 7860:7860 -e AUTH_SECRET=… -e DEMO_MODE=true -e SITE_PASSWORD=… dms-demo
FROM node:24-bookworm-slim

# Postgres 17 from the PGDG apt repository (Debian bookworm ships 15), openssl for Prisma.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg openssl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-17 \
 && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces runs the container as uid 1000, which is the image's `node` user.
USER node
ENV HOME=/home/node \
    PATH=/usr/lib/postgresql/17/bin:$PATH \
    PGDATA=/home/node/pgdata \
    PGHOST=/tmp \
    DATABASE_URL="postgresql://node@localhost:5432/dms_demo?host=/tmp" \
    NEXT_TELEMETRY_DISABLED=1 \
    AUTH_TRUST_HOST=true \
    PORT=7860
WORKDIR /home/node/app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY --chown=node:node . .
RUN npx prisma generate

# Build the app and seed the demo database in one layer. The seed starts at today's date, so the
# business date of the demo is the date of the last build. AUTH_SECRET here only satisfies the
# build; the real one is a run-time secret.
RUN initdb --username=node --auth=trust --encoding=UTF8 --locale=C.UTF-8 \
 && pg_ctl -o "-k /tmp -c listen_addresses=localhost" -l /tmp/postgres-build.log -w start \
 && createdb dms_demo \
 && npx tsx scripts/db-reset.ts \
 && AUTH_SECRET=build-only-placeholder npx next build \
 && pg_ctl -m fast -w stop \
 && rm -rf /tmp/postgres-build.log /home/node/.npm

EXPOSE 7860
CMD ["sh", "docker/start.sh"]
