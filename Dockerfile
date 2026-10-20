# Hackban production image.
# Data lives in Postgres (DATABASE_URL); uploaded files on a volume at /data.
# Run exactly ONE replica — realtime updates use an in-process event bus.

FROM oven/bun:1.1.34 AS deps
WORKDIR /app
COPY package.json bun.lockb ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile

FROM oven/bun:1.1.34 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Regenerate the Prisma client for Linux (the committed one targets macOS).
RUN bunx prisma generate
ENV SKIP_ENV_VALIDATION=1 NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM oven/bun:1.1.34 AS run
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
# Apply schema changes on boot (additive db push), then start.
CMD ["sh", "-c", "mkdir -p /data/uploads && bunx prisma db push --skip-generate && bun server.js"]
