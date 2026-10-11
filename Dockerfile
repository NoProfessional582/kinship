# syntax=docker/dockerfile:1

# Every stage runs on this one exact Node.js image.
ARG NODE_IMAGE=node:24.21.0-alpine3.24

# ---------- deps ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ---------- builder ----------
# Builds the web app. scripts/test-stack.sh also runs the database test suite in
# it, because it has the whole toolchain; nothing else runs this stage.
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Only needed to satisfy prisma.config.ts during `generate`; nothing connects
# to a database at build time.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# ---------- cli ----------
# The command-line jobs (migrations, seed, archive export and import, LinkedIn
# import): the npm scripts, their sources, and only the packages they use, taken
# from the builder's install (docker/cli-modules.mjs). It becomes /app/cli in the
# runner, apart from the web server's own node_modules, so neither can shadow the
# other's packages.
FROM ${NODE_IMAGE} AS cli
WORKDIR /build
COPY --from=builder /app/node_modules ./node_modules
COPY package.json prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY lib ./lib
COPY docker/cli-modules.mjs ./docker/
RUN node docker/cli-modules.mjs /build /app/cli \
    && cp -r package.json prisma.config.ts tsconfig.json prisma lib /app/cli/

# ---------- runner ----------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="Kinship" \
      org.opencontainers.image.description="One person's contacts, notes and tasks, on their own computer" \
      org.opencontainers.image.source="https://github.com/NoProfessional582/kinship" \
      org.opencontainers.image.version="0.4.0" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next's standalone server binds to process.env.HOSTNAME. Left unset it resolves
# to localhost, which listens only on container loopback and makes the published
# port refuse every connection. This line is load-bearing.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# The CLI runs through npm; keep its "new version available" notice out of the logs.
ENV npm_config_update_notifier=false

# uid 1001: compose.yaml's migrate job hands data/uploads to this user.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# The generated Prisma client, for the web server.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# The command-line jobs, run by compose.yaml's `migrate` service from /app/cli.
# lib/uploads.ts uses the physical /app/public/uploads root for both entry
# points. Keep the public alias for the existing command-line folder layout.
COPY --from=cli /app/cli ./cli
RUN ln -s ../public ./cli/public

RUN mkdir -p /app/public/uploads && chown -R nextjs:nodejs /app/public/uploads

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
