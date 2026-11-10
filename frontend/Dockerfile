# =============================================================================
# frontend - Multi-stage build (Vite -> Nginx)
# =============================================================================
FROM node:22.23.4-alpine AS builder
WORKDIR /app

# VITE_API_URL se inyecta en build-time porque Vite hace tree-shaking de envs.
ARG VITE_API_URL=http://localhost:8080
ENV VITE_API_URL=$VITE_API_URL

COPY package*.json ./
RUN npm install

COPY tsconfig.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

# -----------------------------------------------------------------------------
FROM nginx:1.28.3-alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
