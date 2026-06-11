# No headless browser needed — the scraper drives the legacy ASP.NET site
# with plain HTTP postbacks. Go binary accelerates list scanning when SCRAPER_ENGINE=go.
FROM golang:1.22-bookworm AS gobuild
WORKDIR /app/scraper-go
COPY scraper-go/go.mod scraper-go/go.sum* ./
COPY scraper-go/ ./
RUN go build -o scan-bin ./cmd/scan && go build -o bench-bin ./cmd/bench

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
COPY seed/ ./seed/
COPY --from=gobuild /app/scraper-go/scan-bin ./scraper-go/scan-bin
COPY --from=web /app/web/dist ./web/dist
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 3001
CMD ["node", "server/index.js"]
