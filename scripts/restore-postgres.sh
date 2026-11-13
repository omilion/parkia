#!/usr/bin/env bash
# Restaura un respaldo hecho con scripts/backup-postgres.sh, o comprueba que se puede restaurar.
#
#   Verificar (recomendado semanal, no toca produccion):
#     PARKIA_BACKUP_PASSPHRASE_FILE=/etc/parkia/backup.key scripts/restore-postgres.sh --verify ARCHIVO
#   Restaurar de verdad:
#     CONFIRM_RESTORE_INTO=nombre_de_la_base scripts/restore-postgres.sh ARCHIVO postgresql://admin@host/nombre_de_la_base
#
# ARCHIVO: parkia-pg-*.tar.gz o parkia-pg-*.tar.gz.gpg (este ultimo pide PARKIA_BACKUP_PASSPHRASE_FILE).
# --verify crea una base temporal en el servidor de PARKIA_PG_ADMIN_URL, restaura ahi, revisa que haya datos y la borra.
set -euo pipefail

fail() { echo "[restore] ERROR: $*" >&2; exit 1; }

MODE="restore"
if [ "${1:-}" = "--verify" ]; then MODE="verify"; shift; fi
ARCHIVE="${1:-}"
[ -n "${ARCHIVE}" ] && [ -f "${ARCHIVE}" ] || fail "indica el archivo de respaldo (parkia-pg-*.tar.gz[.gpg])"
PASSPHRASE_FILE="${PARKIA_BACKUP_PASSPHRASE_FILE:-}"
ADMIN_URL="${PARKIA_PG_ADMIN_URL:-${DATABASE_URL:-}}"

WORKDIR="$(mktemp -d)"
TEMP_DB=""
cleanup() {
  if [ -n "${TEMP_DB}" ] && [ -n "${ADMIN_URL}" ]; then
    psql "${ADMIN_URL}" -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS \"${TEMP_DB}\"" >/dev/null 2>&1 || true
  fi
  rm -rf "${WORKDIR}"
}
trap cleanup EXIT

# 1. Integridad: el hash guardado junto al respaldo debe coincidir.
if [ -f "${ARCHIVE}.sha256" ]; then
  ( cd "$(dirname "${ARCHIVE}")" && sha256sum --check --status "$(basename "${ARCHIVE}").sha256" ) \
    || fail "el hash no coincide: el respaldo esta danado o fue modificado"
  echo "[restore] hash correcto"
else
  echo "[restore] aviso: no hay archivo .sha256 junto al respaldo; no se pudo comprobar su integridad"
fi

# 2. Descifrar (si corresponde) y desempaquetar.
TARBALL="${ARCHIVE}"
case "${ARCHIVE}" in
  *.gpg)
    [ -s "${PASSPHRASE_FILE}" ] || fail "el respaldo esta cifrado: define PARKIA_BACKUP_PASSPHRASE_FILE"
    TARBALL="${WORKDIR}/backup.tar.gz"
    gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "${PASSPHRASE_FILE}" -o "${TARBALL}" --decrypt "${ARCHIVE}" \
      || fail "no se pudo descifrar (clave incorrecta o archivo danado)"
    ;;
esac
tar -xzf "${TARBALL}" -C "${WORKDIR}" parkia.dump || fail "el archivo no contiene parkia.dump"

if [ "${MODE}" = "verify" ]; then
  [ -n "${ADMIN_URL}" ] || fail "--verify necesita PARKIA_PG_ADMIN_URL (usuario con permiso para crear bases)"
  TEMP_DB="parkia_verify_$(date -u +%Y%m%d%H%M%S)_$$"
  psql "${ADMIN_URL}" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"${TEMP_DB}\"" >/dev/null
  # Misma URL con otro nombre de base.
  TARGET_URL="$(printf '%s' "${ADMIN_URL}" | sed -E "s#(/)[^/?]+(\?|$)#\1${TEMP_DB}\2#")"
  pg_restore --no-owner --exit-on-error -d "${TARGET_URL}" "${WORKDIR}/parkia.dump" >/dev/null \
    || fail "pg_restore fallo: el respaldo NO se puede restaurar"
  # Una restauracion "exitosa" de una base vacia no sirve: debe haber empresas y migraciones aplicadas.
  TENANTS="$(psql "${TARGET_URL}" -Atc "SELECT COUNT(*) FROM tenants")"
  TABLES="$(psql "${TARGET_URL}" -Atc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")"
  [ "${TENANTS}" -gt 0 ] || fail "la restauracion no trajo empresas (tenants vacio)"
  echo "[restore] VERIFICADO: ${TABLES} tablas, ${TENANTS} empresa(s). Base temporal eliminada."
  exit 0
fi

# 3. Restauracion real, con una confirmacion explicita para no pisar la base equivocada.
TARGET_URL="${2:-}"
[ -n "${TARGET_URL}" ] || fail "indica la URL de la base de destino"
DB_NAME="$(printf '%s' "${TARGET_URL}" | sed -E 's#^[^:]+://[^/]+/([^/?]+).*$#\1#')"
[ "${CONFIRM_RESTORE_INTO:-}" = "${DB_NAME}" ] \
  || fail "esto reemplaza los datos de la base \"${DB_NAME}\". Repite con CONFIRM_RESTORE_INTO=${DB_NAME} para confirmar"
pg_restore --clean --if-exists --no-owner --exit-on-error -d "${TARGET_URL}" "${WORKDIR}/parkia.dump"
echo "[restore] base \"${DB_NAME}\" restaurada."

# Los adjuntos viajan en el mismo respaldo: con PARKIA_RESTORE_STORAGE_DIR se extraen ahi.
if [ -n "${PARKIA_RESTORE_STORAGE_DIR:-}" ]; then
  mkdir -p "${PARKIA_RESTORE_STORAGE_DIR}"
  tar -xzf "${TARBALL}" -C "${PARKIA_RESTORE_STORAGE_DIR}" --exclude=parkia.dump
  echo "[restore] adjuntos extraidos en ${PARKIA_RESTORE_STORAGE_DIR}"
else
  echo "[restore] aviso: los adjuntos (carpeta storage/) no se restauraron; define PARKIA_RESTORE_STORAGE_DIR para extraerlos"
fi
