FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
# Chromium for the PDF renderer
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-dejavu ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# standalone output includes a traced node_modules (pg, sharp, sdk, etc.)
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY db ./db
EXPOSE 3000
CMD ["node", "server.js"]
