FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# Install Chromium for Playwright (if needed for scraping)
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
RUN mkdir -p uploads logs

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "dist/main"]
