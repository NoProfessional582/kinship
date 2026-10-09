# syntax=docker/dockerfile:1

# Every stage runs on this one exact Node.js image.
ARG NODE_IMAGE=node:24.21.0-alpine3.24

# ---------- deps ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ---------- builder ----------
# Also serves as the image for the one-shot `migrate` service and for seeding,
# because it is the only stage with the full toolchain (Prisma CLI, tsx).
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Only needed to satisfy prisma.config.ts during `generate`; nothing connects
# to a database at build time.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# ---------- runner ----------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next's standalone server binds to process.env.HOSTNAME. Left unset it resolves
# to localhost, which listens only on container loopback and makes the published
# port refuse every connection. This line is load-bearing.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# uid 1001: compose.yaml's migrate job hands data/uploads to this user.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# The generated Prisma client. Migrations run in the separate `migrate` service,
# so the Prisma CLI is deliberately absent from this image.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

RUN mkdir -p /app/public/uploads && chown -R nextjs:nodejs /app/public/uploads

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
