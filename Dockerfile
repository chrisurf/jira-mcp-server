# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist/ dist/
# Config file can be mounted at /app/config/config.json
VOLUME /app/config
ENV NODE_ENV=production
ENTRYPOINT ["node", "dist/server.js"]
