FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

FROM oven/bun:1-alpine AS runner
WORKDIR /app
COPY --from=builder /app/package.json /app/bun.lock ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
ENV NODE_ENV=production
EXPOSE 3001
CMD ["bun", "run", "src/server-manager/index.ts"]
