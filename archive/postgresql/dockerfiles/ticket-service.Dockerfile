FROM node:20-alpine AS builder
WORKDIR /app

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
COPY prisma ./prisma
COPY scripts ./scripts
RUN npm install --omit=dev
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

EXPOSE 3003
CMD ["sh", "-c", "npx prisma db push && node dist/index.js"]
