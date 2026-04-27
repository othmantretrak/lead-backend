FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependency files
COPY package.json pnpm-lock.yaml ./

# Install deps
RUN pnpm install --frozen-lockfile

# Copy source and config
COPY tsconfig.json ./
COPY src/ ./src/
COPY migrations/ ./migrations/

# Build TS → JS
RUN pnpm run build

EXPOSE 3001

CMD ["node", "dist/index.js"]