FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/        # adjust to your structure

# Build TS → JS
RUN npm run build

EXPOSE 3001
CMD ["node", "dist/server.js"]