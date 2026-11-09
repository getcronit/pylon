#!/usr/bin/env bash
#───────────────────────────────────────────────────────────────────────────────
# Shenasa Database Migration Script
#
#  ▸ dev   : `prisma migrate dev` against local SQLite
#  ▸ prod  : Apply every SQL file under prisma/migrations to Cloudflare D1
#
#  New in this version
#  ───────────────────
#  • wrangler auto-apply works even if your wrangler.toml lacks migrations_dir
#    (the script makes a temporary symlink).                             
#  • Manual fallback now *skips* migrations already recorded in            
#    the `_prisma_migrations` table, so re-runs never bomb on “table exists”.
#  • Requires jq (already used elsewhere for backups).                     
#───────────────────────────────────────────────────────────────────────────────

set -e                                           # Abort on first uncaught error

###############################################################################
# Configurable defaults
###############################################################################
MIGRATIONS_DIR="${MIGRATIONS_DIR:-prisma/migrations}"   # Where Prisma stores migrations
D1_NAME="mailpress"                                    # D1 binding / database name

###############################################################################
# Pretty output helpers
###############################################################################
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; PURPLE='\033[0;35m'; CYAN='\033[0;36m'; NC='\033[0m'

SUCCESS="✅"; ERROR="❌"; WARNING="⚠️"; INFO="ℹ️"; DATABASE="🗄️"

print_info()    { echo -e "${BLUE}${INFO}  $1${NC}"; }
print_success() { echo -e "${GREEN}${SUCCESS}  $1${NC}"; }
print_warning() { echo -e "${YELLOW}${WARNING}  $1${NC}"; }
print_error()   { echo -e "${RED}${ERROR}  $1${NC}"; }
print_header()  {
  echo -e "${PURPLE}${DATABASE} Shenasa Database Migration Tool${NC}"
  echo -e "${CYAN}======================================${NC}"
}

###############################################################################
# Dependency checks
###############################################################################
check_dependencies() {
  print_info "Checking dependencies…"
  command -v npx      &>/dev/null || { print_error "npx not found";          exit 1; }
  command -v wrangler &>/dev/null || { print_error "wrangler not found";     exit 1; }
  command -v jq       &>/dev/null || { print_error "jq not found";           exit 1; }
  print_success "All dependencies present"
}

###############################################################################
# Environment helpers
###############################################################################
load_env() {
  local env_file="${1:-.env}"
  if [[ -f "$env_file" ]]; then
    print_info "Loading environment from $env_file"
    set -a && source "$env_file" && set +a
    print_success "Environment loaded"
  else
    print_warning "Env file $env_file not found (continuing)"
  fi
}

validate_env() {
  local env_type="$1"
  print_info "Validating ${env_type} environment variables…"
  case "$env_type" in
    dev)
      [[ -z "$DATABASE_URL" ]] && { print_error "DATABASE_URL missing"; exit 1; }
      ;;
    prod)
      [[ -z "$CLOUDFLARE_ACCOUNT_ID" || -z "$CLOUDFLARE_DATABASE_ID" ]] && {
        print_error "Missing Cloudflare credentials (CLOUDFLARE_ACCOUNT_ID/_DATABASE_ID)"; exit 1; }
      if [[ -z "$CLOUDFLARE_D1_TOKEN" ]]; then
        wrangler whoami &>/dev/null || {
          print_error "Run 'wrangler auth login' or export CLOUDFLARE_D1_TOKEN"; exit 1; }
      else
        export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_D1_TOKEN"
      fi
      ;;
  esac
  print_success "Environment ok"
}

###############################################################################
# Utility functions
###############################################################################
backup_dev_db() {
  local db_file=""
  for candidate in "dev.db" "prisma/dev.db" "./dev.db"; do
    [[ -f "$candidate" ]] && { db_file="$candidate"; break; }
  done
  if [[ -n "$db_file" ]]; then
    local backup="${db_file}.backup.$(date +%Y%m%d_%H%M%S)"
    print_info "SQLite backup → $backup"
    cp "$db_file" "$backup"
  fi
}

generate_client() {
  print_info "Generating Prisma client"
  npx prisma generate
  print_success "Prisma client ready"
}

# Return 0 (success) if a given migration name is already in _prisma_migrations
migration_already_applied() {
  local mig_name="$1"
  local exists
  exists=$(wrangler d1 execute "$D1_NAME" \
    --command="SELECT 1 FROM sqlite_master WHERE type='table' AND name='_prisma_migrations';" \
    --json 2>/dev/null | jq -r '.[].results[0][0] // empty') || true
  [[ -z "$exists" ]] && return 1     # table missing → treat as “not applied”

  local applied
  applied=$(wrangler d1 execute "$D1_NAME" \
    --command="SELECT 1 FROM _prisma_migrations WHERE migration_name='$mig_name' LIMIT 1;" \
    --json 2>/dev/null | jq -r '.[].results[0][0] // empty') || true
  [[ -n "$applied" ]]
}

###############################################################################
# Development workflow
###############################################################################
migrate_dev() {
  print_header; load_env ".env"; validate_env dev; backup_dev_db
  print_info "Running local Prisma migration (migrate dev)"
  npx prisma migrate dev --name "${MIGRATION_NAME:-auto_migration}"
  generate_client
  print_success "Local migrate dev complete"
}

###############################################################################
# Production workflow (idempotent)
###############################################################################
migrate_prod() {
  print_header; load_env ".env"; validate_env prod
  print_warning "This will modify the production Cloudflare D1 database!"
  read -rp "Continue? (y/N): " REPLY; [[ ! $REPLY =~ ^[Yy]$ ]] && { echo; print_info "Cancelled"; exit 0; }

  #---------------------------------------------------------------------------
  # Ensure migrations directory exists
  #---------------------------------------------------------------------------
  [[ -d "$MIGRATIONS_DIR" ]] || { print_error "Directory '$MIGRATIONS_DIR' not found"; exit 1; }
  print_info "Using migrations from $MIGRATIONS_DIR"

  #---------------------------------------------------------------------------
  # Try wrangler’s own migration runner (preferred, if toml is configured)
  # If wrangler can’t find the folder, we create a temporary symlink ‘migrations’
  #---------------------------------------------------------------------------
  TEMP_SYMLINK=false
  if [[ ! -d "migrations" ]]; then
    ln -s "$MIGRATIONS_DIR" migrations
    TEMP_SYMLINK=true
  fi

  print_info "Trying wrangler d1 migrations apply…"
  if wrangler d1 migrations apply "$D1_NAME" --remote; then
    print_success "Wrangler applied migrations successfully"
  else
    print_warning "Wrangler auto-apply failed; falling back to manual execution"

    #-----------------------------------------------------------------------
    # Manual loop (idempotent): skip if already in _prisma_migrations
    #-----------------------------------------------------------------------
    while IFS= read -r -d '' dir; do
      MIG_FILE="${dir}/migration.sql"
      [[ -f "$MIG_FILE" ]] || continue
      MIG_NAME="$(basename "$dir")"

      if migration_already_applied "$MIG_NAME"; then
        print_info "$MIG_NAME already applied – skipping"
        continue
      fi

      print_info "Applying $MIG_NAME"
      if wrangler d1 execute "$D1_NAME" --file="$MIG_FILE" --remote; then
        print_success "$MIG_NAME applied"
      else
        print_error "Failed on $MIG_NAME, aborting"
        [[ "$TEMP_SYMLINK" == true ]] && rm migrations
        exit 1
      fi
    done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -mindepth 1 -type d -print0 | sort -z)

    print_success "Manual migration loop finished"
  fi

  [[ "$TEMP_SYMLINK" == true ]] && rm migrations
  generate_client
  print_success "Production migrations complete!"
}

###############################################################################
# Reset, seed, status, etc. (unchanged behaviour but commented)
###############################################################################
reset_dev() {
  print_header; load_env ".env"; validate_env dev
  print_warning "All local data will be LOST!"
  read -rp "Really reset? (y/N): " REPLY; [[ ! $REPLY =~ ^[Yy]$ ]] && { echo; print_info "Cancelled"; exit 0; }
  backup_dev_db
  npx prisma migrate reset --force
  generate_client
  print_success "Dev database reset"
}

seed_db() {
  local env_type="${1:-dev}"; print_header; load_env ".env"; validate_env "$env_type"
  print_info "Seeding $env_type database"
  if [[ "$env_type" == "prod" ]]; then
    print_warning "Seeding PRODUCTION data!"
    read -rp "Continue? (y/N): " REPLY; [[ ! $REPLY =~ ^[Yy]$ ]] && { echo; print_info "Cancelled"; exit 0; }
  fi
  npm run db:seed
  print_success "Seeding done"
}

check_status() {
  print_header; load_env ".env"
  print_info "Local migrate status"; npx prisma migrate status || true

  if [[ -n "$CLOUDFLARE_ACCOUNT_ID" && -n "$CLOUDFLARE_DATABASE_ID" ]]; then
    print_info "Remote (D1) table list:"
    wrangler d1 execute "$D1_NAME" --command \
      "SELECT name FROM sqlite_master WHERE type='table';" || true
  fi
}

create_migration() {
  print_header; load_env ".env"; validate_env dev
  MIGRATION_NAME="${MIGRATION_NAME:-$1}"
  [[ -z "$MIGRATION_NAME" ]] && { read -rp "Migration name: " MIGRATION_NAME; }
  [[ -z "$MIGRATION_NAME" ]] && { print_error "Name required"; exit 1; }
  npx prisma migrate dev --name "$MIGRATION_NAME" --create-only
  print_success "Migration folder created (not applied)"
}

studio() {
  print_header; load_env ".env"; print_info "Launching Prisma Studio…"; npx prisma studio
}

execute_d1() { print_header; load_env ".env"; validate_env prod
  [[ -z "$1" ]] && { print_error "SQL missing"; exit 1; }
  wrangler d1 execute "$D1_NAME" --command="$1"
}

d1_info() { print_header; load_env ".env"; validate_env prod
  print_info "Cloudflare D1 info ($D1_NAME)"
  wrangler d1 execute "$D1_NAME" --command \
    "SELECT name FROM sqlite_master WHERE type='table';"
}

backup_d1() {
  print_header; load_env ".env"; validate_env prod

  # 1) Choose filename
  local out="d1_backup_$(date +%Y%m%d_%H%M%S).sql"
  print_info "Exporting D1 to $out"

  # 2) Use Wrangler’s native export command (works on v3+)
  #    --remote     : hit the production DB
  #    --output ... : write raw SQL dump (schema + data)
  if wrangler d1 export "$D1_NAME" --remote --output "$out"; then
    print_success "Backup written to $out"
  else
    print_error "wrangler d1 export failed"
    print_info  "If you are on an old Wrangler, upgrade with:"
    print_info  "    npm install --save-dev wrangler@latest"
    exit 1
  fi
}

###############################################################################
# CLI parsing
###############################################################################
COMMAND=""; SUBCOMMAND=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) MIGRATION_NAME="$2"; shift 2;;
    --env)  ENV_FILE="$2";       shift 2;;
    *)      [[ -z "$COMMAND" ]] && COMMAND="$1" || SUBCOMMAND="$1"; shift;;
  esac
done

check_dependencies  # Always verify before doing anything

case "$COMMAND" in
  dev)         migrate_dev;;
  prod)        migrate_prod;;
  reset)       reset_dev;;
  seed)        seed_db "$SUBCOMMAND";;
  status)      check_status;;
  create)      create_migration "$SUBCOMMAND";;
  studio)      studio;;
  d1-info)     d1_info;;
  d1-exec)     execute_d1 "$SUBCOMMAND";;
  d1-backup)   backup_d1;;
  ""|help|-h|--help)
cat <<'EOF'
Usage: ./scripts/migrate.sh <command> [options]

Commands
  dev                   Run dev migrations (SQLite)
  prod                  Apply all migrations to Cloudflare D1 (idempotent)
  reset                 Reset dev DB (DESTROYS DATA)
  seed [dev|prod]       Seed database
  status                Show migration status
  create [name]         Create migration (not applied)
  studio                Open Prisma Studio
  d1-info               Show D1 info
  d1-exec   "SQL"       Execute raw SQL on D1
  d1-backup             Dump D1 schema to file

Common options
  --name <name>         Migration name (dev/create)
  --env  <file>         Alternate .env file
EOF
  ;;
  *) print_error "Unknown command $COMMAND"; exit 1;;
esac
