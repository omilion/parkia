#!/usr/bin/env bash
# Respaldo completo con PostgreSQL: volcado de la base (pg_dump, formato custom) + archivos adjuntos.
# Restaurar: pg_restore --clean --if-exists -d "$PARKIA_PG_ADMIN_URL" parkia.dump  (ver docs/POSTGRES.md)
set -euo pipefail

PG_URL="${PARKIA_PG_ADMIN_URL:-${DATABASE_URL:-}}"
STORAGE_PATH="${PARKIA_STORAGE_PATH:-/var/lib/parkia/storage}"
BACKUP_PATH="${PARKIA_BACKUP_PATH:-/var/backups/parkia}"
RETENTION_DAYS="${PARKIA_BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="$(mktemp -d)"
DEST="${BACKUP_PATH}/parkia-pg-${STAMP}.tar.gz"
STORAGE_NAME="$(basename "${STORAGE_PATH}")"

cleanup() {
  rm -rf "${WORKDIR}"
}
trap cleanup EXIT

if [ -z "${PG_URL}" ]; then
  echo "Falta PARKIA_PG_ADMIN_URL (o DATABASE_URL)" >&2
  exit 1
fi
if [ ! -d "${STORAGE_PATH}" ]; then
  echo "Storage directory not found: ${STORAGE_PATH}" >&2
  exit 1
fi

mkdir -p "${BACKUP_PATH}"
pg_dump --format=custom --no-owner --file="${WORKDIR}/parkia.dump" "${PG_URL}"
# Enlace a los adjuntos dentro del directorio de trabajo: un solo -C sirve en GNU tar y en BusyBox.
ln -s "${STORAGE_PATH}" "${WORKDIR}/${STORAGE_NAME}"
tar -C "${WORKDIR}" -czhf "${DEST}" parkia.dump "${STORAGE_NAME}"

find "${BACKUP_PATH}" -name "parkia-pg-*.tar.gz" -type f -mtime "+${RETENTION_DAYS}" -delete
echo "PostgreSQL backup created: ${DEST}"
