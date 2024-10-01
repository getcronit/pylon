## Example: Pylon on Cloudflare Workers with Drizzle and D1

To setup project for your Cloudflare D1 - please refer to [official docs](https://developers.cloudflare.com/d1/)

```toml
## Update your wrangler.toml accordingly
[[ d1_databases ]]
binding = "DB"
database_name = "YOUR DB NAME"
database_id = "YOUR DB ID"
```

To init local database and run server locally

```bash
npm run wrangler d1 execute <DATABASE_NAME> --local --file=./drizzle/0000_sudden_brother_voodoo.sql
npm run dev
```

Generate migration files after changing `./src/schema.ts`

```bash
npm run generate
```

## Deploying to Cloudflare D1

Executing migration files on production

```bash
npm run wrangler d1 execute <DATABASE_NAME> --remote --file=./drizzle/0000_sudden_brother_voodoo.sql
```

Deploying Pylon to Cloudflare Workers

```bash
npm run deploy
```
