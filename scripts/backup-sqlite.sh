#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${PARKIA_DB_PATH:-${TIOLUCHIN_DB_PATH:-/var/lib/parkia/parkia.db}}"
BACKUP_PATH="${PARKIA_BACKUP_PATH:-${TIOLUCHIN_BACKUP_PATH:-/var/backups/parkia}}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_PATH}/parkia-${STAMP}.sqlite"

mkdir -p "${BACKUP_PATH}"

if [ ! -f "${DB_PATH}" ]; then
  echo "Database not found: ${DB_PATH}" >&2
  exit 1
fi

sqlite3 "${DB_PATH}" ".backup '${DEST}'"
gzip -f "${DEST}"

find "${BACKUP_PATH}" -name "parkia-*.sqlite.gz" -type f -mtime +30 -delete
echo "Backup created: ${DEST}.gz"
