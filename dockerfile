FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci

# Copy source and config
COPY tsconfig.json ./
COPY src/ ./src/
COPY migrations/ ./migrations/

# Build TS → JS
RUN npm run build

EXPOSE 3001

CMD ["node", "dist/index.js"]