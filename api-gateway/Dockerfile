# =============================================================================
# api-gateway - Multi-stage build
# =============================================================================
FROM node:22.23.4-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
RUN npm install

COPY src ./src
RUN npm run build

# -----------------------------------------------------------------------------
FROM node:22.23.4-alpine AS runner
WORKDIR /app

RUN apk add --no-cache wget

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 8080
CMD ["node", "dist/index.js"]
