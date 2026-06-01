#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${PARKIA_DB_PATH:-${TIOLUCHIN_DB_PATH:-/var/lib/parkia/parkia.db}}"
STORAGE_PATH="${PARKIA_STORAGE_PATH:-${TIOLUCHIN_STORAGE_PATH:-/var/lib/parkia/storage}}"
BACKUP_PATH="${PARKIA_BACKUP_PATH:-${TIOLUCHIN_BACKUP_PATH:-/var/backups/parkia}}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="$(mktemp -d)"
DEST="${BACKUP_PATH}/parkia-full-${STAMP}.tar.gz"
STORAGE_PARENT="$(dirname "${STORAGE_PATH}")"
STORAGE_NAME="$(basename "${STORAGE_PATH}")"

cleanup() {
  rm -rf "${WORKDIR}"
}
trap cleanup EXIT

mkdir -p "${BACKUP_PATH}"

if [ ! -f "${DB_PATH}" ]; then
  echo "Database not found: ${DB_PATH}" >&2
  exit 1
fi

if [ ! -d "${STORAGE_PATH}" ]; then
  echo "Storage directory not found: ${STORAGE_PATH}" >&2
  exit 1
fi

sqlite3 "${DB_PATH}" ".backup '${WORKDIR}/parkia.db'"
tar -C "${WORKDIR}" -czf "${DEST}" parkia.db -C "${STORAGE_PARENT}" "${STORAGE_NAME}"

find "${BACKUP_PATH}" -name "parkia-full-*.tar.gz" -type f -mtime +30 -delete
echo "Full backup created: ${DEST}"
