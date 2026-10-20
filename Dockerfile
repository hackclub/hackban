# Hackban production image.
# Data lives in Postgres (DATABASE_URL); uploaded files on a volume at /data.
# Run exactly ONE replica — realtime updates use an in-process event bus.
#
# Bun installs dependencies (it owns bun.lockb); Node runs `next build` and the
# server, since Next.js isn't supported on Bun's runtime.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN npm install -g bun@1.1.34
COPY package.json bun.lockb ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile --ignore-scripts

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Regenerate the Prisma client for Linux (the committed one targets macOS).
RUN npx prisma generate
ENV SKIP_ENV_VALIDATION=1 NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/data/uploads AUTH_TRUST_HOST=true
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/generated ./generated
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
VOLUME /data
EXPOSE 3000
# Apply schema changes on boot (refuses destructive changes), then start.
CMD ["sh", "-c", "mkdir -p /data/uploads && node node_modules/prisma/build/index.js db push --skip-generate && node server.js"]
