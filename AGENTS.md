# Agent Guidance

## Core Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start dev server with hot reload |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run production build |
| `pnpm db:push` | Push schema changes to DB |
| `pnpm db:studio` | Open Drizzle Studio GUI |
| `pnpm db:generate` | Generate migration files |

## Stack

- **Runtime**: Node.js (Express)
- **Auth**: Clerk (`@clerk/express`)
- **ORM**: Drizzle + PostgreSQL (Neon)
- **Payments**: Mollie
- **Scraping**: Playwright + Puppeteer-stealth
- **Scheduling**: node-cron
- **Validation**: Zod

## Required Env Variables

```
DATABASE_URL=postgresql://...
CLERK_SECRET_KEY=sk_test_...
MOLLIE_API_KEY=m_test_...
ALLOWED_ORIGIN=http://localhost:3000
PORT=3001
```

## Docker

- Dockerfile uses Playwright image (`mcr.microsoft.com/playwright:v1.59.1-noble`)
- **Sync with package.json**: Update both when upgrading Playwright version
- docker-compose expects `.env` at project root

## Project Structure

```
src/
├── index.ts         # Entry point, Express app setup
├── routes/          # API endpoints (leads, emails, scraper, billing, etc.)
├── services/        # Business logic (mailer, scraper, scheduler, copilot)
├── db/              # Drizzle schema + drizzle.ts connection
├── middleware/     # Auth (Clerk), error handler
├── validators/      # Zod schemas
└── types/           # TypeScript augmentations
```

## Known Issues

- `zod: ^4.4.3` in package.json — v4 is not stable; should likely be `^3.x`
- No test framework configured (no Jest, Vitest, or test scripts)
- No ESLint/Prettier setup

## DB Migrations

- Schema lives in `src/db/schema.ts`
- Migrations output to `./migrations`
- Run `pnpm db:generate` then `pnpm db:push` after schema changes