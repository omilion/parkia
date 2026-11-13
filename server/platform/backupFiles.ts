/** Respaldos reconocidos: SQLite (.sqlite[.gz]), completos de SQLite (parkia-full-*) y de PostgreSQL (parkia-pg-*, cifrados o no). */
export const BACKUP_FILE_PATTERN = /^(parkia|tioluchin)-.+\.sqlite(\.gz)?$|^parkia-full-.+\.tar\.gz$|^parkia-pg-.+\.tar\.gz(\.gpg)?$/;
