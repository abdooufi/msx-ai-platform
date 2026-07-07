#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# MSX AI Platform — backup script (Linux/macOS/Git Bash)
#
# Backs up:
#   1. PostgreSQL (Chatboot DB)  → pg_dump custom format
#   2. Qdrant                    → snapshot per collection (stored by Qdrant
#                                  itself under ./data/qdrant/snapshots)
#   3. Uploaded documents        → tar.gz of ./data/uploads
#
# Usage:   ./scripts/backup.sh [backup-dir]
# Cron:    30 2 * * * /path/to/msx-ai-platform/scripts/backup.sh
#
# Config via env (defaults match .env defaults):
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE  — Postgres connection
#   QDRANT_URL                                  — default http://localhost:6333
#   KEEP_DAYS                                   — default 14
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${1:-$ROOT/backups}"
STAMP="$(date +%Y-%m-%d_%H%M)"
KEEP_DAYS="${KEEP_DAYS:-14}"
QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGDATABASE="${PGDATABASE:-Chatboot}"
# PGPASSWORD must come from the environment — do not hardcode credentials here

mkdir -p "$BACKUP_DIR"
echo "── MSX AI backup → $BACKUP_DIR ($STAMP)"

# 1. PostgreSQL
if command -v pg_dump >/dev/null 2>&1; then
  echo "→ pg_dump $PGDATABASE"
  pg_dump --format=custom --file="$BACKUP_DIR/pg_${PGDATABASE}_$STAMP.dump"
else
  echo "⚠ pg_dump not found — skipping Postgres backup (install postgresql-client)"
fi

# 2. Qdrant snapshots (one per collection, stored inside Qdrant's own storage dir)
echo "→ Qdrant snapshots"
collections=$(curl -sf "$QDRANT_URL/collections" | grep -o '"name":"[^"]*"' | cut -d'"' -f4 || true)
for c in $collections; do
  echo "   snapshot: $c"
  curl -sf -X POST "$QDRANT_URL/collections/$c/snapshots" >/dev/null \
    || echo "   ⚠ snapshot failed for $c"
done

# 3. Uploaded documents
if [ -d "$ROOT/data/uploads" ]; then
  echo "→ uploads archive"
  tar -czf "$BACKUP_DIR/uploads_$STAMP.tar.gz" -C "$ROOT/data" uploads
fi

# 4. Retention
echo "→ pruning backups older than $KEEP_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'pg_*.dump' -o -name 'uploads_*.tar.gz' \) \
  -mtime "+$KEEP_DAYS" -delete 2>/dev/null || true

echo "✅ Backup complete"
