# No headless browser needed — the scraper drives the legacy ASP.NET site
# with plain HTTP postbacks, so a slim Node image is enough.
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server/ ./server/
COPY --from=web /app/web/dist ./web/dist
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 3001
CMD ["node", "server/index.js"]
