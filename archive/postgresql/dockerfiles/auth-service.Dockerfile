# =============================================================================
# auth-service - Multi-stage build
# =============================================================================
FROM node:20-alpine AS builder
WORKDIR /app

# Necesario para Prisma engines + healthcheck wget
RUN apk add --no-cache openssl

COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma
RUN npm install
RUN npx prisma generate

COPY src ./src
RUN npm run build

# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl wget

COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma
RUN npm install --omit=dev
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 3001
CMD ["sh", "-c", "npx prisma db push && npx prisma db seed && node dist/index.js"]
