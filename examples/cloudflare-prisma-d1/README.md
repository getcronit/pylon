# Deployment Guide for `cloudflare-prisma-d1` 🚀

This guide covers deploying **cloudflare-prisma-d1** (your Pylon + Prisma + D1 example) to Cloudflare Workers using Yarn.

## Cloudflare Workers (Recommended) ☁️

### Prerequisites ✅

* A Cloudflare account
* Node.js 18+ and Yarn
* Wrangler CLI installed globally

### Initial Setup 🔧

1. **Install Wrangler CLI:**

   ```bash
   yarn global add wrangler
   ```

2. **Authenticate with Cloudflare:**

   ```bash
   wrangler auth login
   ```

3. **Clone and install dependencies:**

   ```bash
   git clone https://github.com/getcronit/pylon.git
   cd pylon/examples/cloudflare-prisma-d1
   yarn
   ```

4. **Generate types & build:**

   ```bash
   yarn cf-typegen
   yarn build
   ```

## Database Migrations & Seeding 🗄️

We use the `./scripts/migrate.sh` helper for both local and D1 migrations:

* **Local dev migration:**

  ```bash
  yarn migrate:seed        # Seed dev (SQLite) if needed  
  yarn migrate:reset       # Reset and reapply SQLite migrations  
  yarn migrate:status      # Show local & remote status  
  yarn migrate:studio      # Launch Prisma Studio  
  ```

* **Prod (D1) migration:**

  ```bash
  yarn migrate:deploy      # Apply all migrations to Cloudflare D1  
  yarn migrate:seed        # Seed production (prompted)  
  yarn d1:info             # List D1 tables  
  yarn d1:backup           # Dump D1 schema + data to SQL  
  ```

> ⚙️ The script auto-skips already applied migrations and creates a temp symlink if needed.

## Environment Variables 🔑

* **Local (`.env`):**

  ```ini
  DATABASE_URL="file:./dev.db"
  ```

* **Cloudflare (Workers):**

  ```bash
  wrangler secret put ADMIN_SECRET_KEY
  ```

* **For prod migrations (if not using `wrangler auth`):**

  ```bash
  export CLOUDFLARE_ACCOUNT_ID="your-account-id"
  export CLOUDFLARE_DATABASE_ID="your-d1-database-id"
  export CLOUDFLARE_D1_TOKEN="your-api-token"
  ```

## Scripts Overview 📜

* `yarn dev`
  Start Pylon & Wrangler Dev with hot-reload

* `yarn start`
  Wrangler Dev only

* `yarn build`
  TypeScript compile

* `yarn deploy`
  Build + Wrangler deploy to production

* `yarn test`
  Run Vitest

