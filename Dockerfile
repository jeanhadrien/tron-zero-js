FROM oven/bun:1 as builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build-nolog

FROM oven/bun:1 as runner

WORKDIR /app

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Copy backend and shared source files (server imports from src)
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json

# Only copy production dependencies (or just use the builder's node_modules if easier)
# We will just copy all node_modules since Phaser Headless is a heavy dependency anyway
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "server/index.ts"]