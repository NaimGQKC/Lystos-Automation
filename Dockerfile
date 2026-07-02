FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Safe default: dry-run unless explicitly overridden at runtime.
ENV DRY_RUN=true

CMD ["node", "dist/index.js", "worker"]
