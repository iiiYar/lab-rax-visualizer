# --- build the static SPA ---------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- runtime: static files + JSON persistence API ---------------------------
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=5173 \
    DATA_DIR=/data

COPY --from=build /app/dist ./dist
COPY server ./server

# Saved racks live here. Mount a volume on /data so they survive rebuilds.
VOLUME ["/data"]
EXPOSE 5173

CMD ["node", "server/index.mjs"]
