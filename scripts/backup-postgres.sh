#!/usr/bin/env bash
# Respaldo completo con PostgreSQL: volcado de la base (pg_dump) + archivos adjuntos, en un solo archivo.
#
#   1. pg_dump (formato custom) + storage  ->  parkia-pg-AAAAMMDDTHHMMSSZ.tar.gz
#   2. Si hay PARKIA_BACKUP_PASSPHRASE_FILE: se cifra con gpg (AES-256, autenticado)  ->  ...tar.gz.gpg
#   3. Si hay PARKIA_S3_BACKUP_BUCKET: se copia a ese bucket (distinto al de los archivos). Solo se sube CIFRADO.
#   4. Se borran las copias locales de mas de PARKIA_BACKUP_RETENTION_DAYS (la retencion remota la fija el bucket).
#
# El archivo se arma en una carpeta oculta y se mueve al final: un respaldo a medias nunca aparece como "el ultimo".
# Restaurar y verificar: scripts/restore-postgres.sh (ver docs/POSTGRES.md). Un respaldo que nunca se restauro no es un respaldo.
set -euo pipefail

PG_URL="${PARKIA_PG_ADMIN_URL:-${DATABASE_URL:-}}"
STORAGE_PATH="${PARKIA_STORAGE_PATH:-/var/lib/parkia/storage}"
BACKUP_PATH="${PARKIA_BACKUP_PATH:-/var/backups/parkia}"
RETENTION_DAYS="${PARKIA_BACKUP_RETENTION_DAYS:-30}"
PASSPHRASE_FILE="${PARKIA_BACKUP_PASSPHRASE_FILE:-}"
S3_BUCKET="${PARKIA_S3_BACKUP_BUCKET:-}"
S3_PREFIX="${PARKIA_S3_BACKUP_PREFIX:-postgres}"
S3_ENDPOINT="${PARKIA_S3_ENDPOINT:-}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="parkia-pg-${STAMP}.tar.gz"
STORAGE_NAME="$(basename "${STORAGE_PATH}")"

fail() { echo "[backup] ERROR: $*" >&2; exit 1; }

[ -n "${PG_URL}" ] || fail "falta PARKIA_PG_ADMIN_URL (o DATABASE_URL)"
[ -d "${STORAGE_PATH}" ] || fail "no existe la carpeta de archivos: ${STORAGE_PATH}"
if [ -n "${PASSPHRASE_FILE}" ]; then
  [ -s "${PASSPHRASE_FILE}" ] || fail "PARKIA_BACKUP_PASSPHRASE_FILE no existe o esta vacio: ${PASSPHRASE_FILE}"
fi
# Un respaldo con datos de clientes no sale del servidor sin cifrar.
if [ -n "${S3_BUCKET}" ] && [ -z "${PASSPHRASE_FILE}" ]; then
  fail "PARKIA_S3_BACKUP_BUCKET requiere PARKIA_BACKUP_PASSPHRASE_FILE: no se sube un respaldo sin cifrar"
fi

mkdir -p "${BACKUP_PATH}"
WORKDIR="$(mktemp -d "${BACKUP_PATH}/.work.XXXXXX")"
cleanup() { rm -rf "${WORKDIR}"; }
trap cleanup EXIT

pg_dump --format=custom --no-owner --file="${WORKDIR}/parkia.dump" "${PG_URL}"
# Enlace a los adjuntos dentro del directorio de trabajo: un solo -C sirve en GNU tar y en BusyBox.
ln -s "${STORAGE_PATH}" "${WORKDIR}/${STORAGE_NAME}"
tar -C "${WORKDIR}" -czhf "${WORKDIR}/${NAME}" parkia.dump "${STORAGE_NAME}"

FINAL="${NAME}"
if [ -n "${PASSPHRASE_FILE}" ]; then
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "${PASSPHRASE_FILE}" \
    --symmetric --cipher-algo AES256 --compress-algo none -o "${WORKDIR}/${NAME}.gpg" "${WORKDIR}/${NAME}"
  rm -f "${WORKDIR}/${NAME}"
  FINAL="${NAME}.gpg"
fi

( cd "${WORKDIR}" && sha256sum "${FINAL}" > "${FINAL}.sha256" )
mv "${WORKDIR}/${FINAL}" "${WORKDIR}/${FINAL}.sha256" "${BACKUP_PATH}/"
echo "[backup] creado: ${BACKUP_PATH}/${FINAL} ($(du -h "${BACKUP_PATH}/${FINAL}" | cut -f1))"

if [ -n "${S3_BUCKET}" ]; then
  command -v aws >/dev/null 2>&1 || fail "la copia externa necesita la CLI de AWS (aws) instalada; el respaldo local quedo en ${BACKUP_PATH}/${FINAL}"
  ENDPOINT_ARGS=()
  [ -n "${S3_ENDPOINT}" ] && ENDPOINT_ARGS=(--endpoint-url "${S3_ENDPOINT}")
  for file in "${FINAL}" "${FINAL}.sha256"; do
    aws s3 cp "${BACKUP_PATH}/${file}" "s3://${S3_BUCKET}/${S3_PREFIX}/${file}" "${ENDPOINT_ARGS[@]}" --only-show-errors \
      || fail "no se pudo copiar ${file} a s3://${S3_BUCKET}/${S3_PREFIX}/ (el respaldo local se conserva)"
  done
  echo "[backup] copiado a s3://${S3_BUCKET}/${S3_PREFIX}/${FINAL}"
fi

find "${BACKUP_PATH}" -maxdepth 1 \( -name "parkia-pg-*.tar.gz" -o -name "parkia-pg-*.tar.gz.gpg" -o -name "parkia-pg-*.sha256" \) \
  -type f -mtime "+${RETENTION_DAYS}" -delete
echo "[backup] listo"
