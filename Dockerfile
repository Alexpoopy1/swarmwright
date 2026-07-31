# Swarmwright — all-in-one image (SQLite included)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S swarm && adduser -S swarm -G swarm
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
# SQLite data lives in a volume so runs survive container restarts
VOLUME ["/app/data"]
ENV DATABASE_URL="file:/app/data/swarmwright.db"
USER swarm
EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm start"]
