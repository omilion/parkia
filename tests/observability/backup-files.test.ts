import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKUP_FILE_PATTERN } from "../../server/platform/backupFiles";

test("el chequeo de salud reconoce los respaldos de SQLite y de PostgreSQL (cifrados o no)", () => {
  for (const name of [
    "parkia-20261113T030000Z.sqlite", "parkia-20261113T030000Z.sqlite.gz", "tioluchin-1.sqlite",
    "parkia-full-20261113T030000Z.tar.gz",
    "parkia-pg-20261113T033000Z.tar.gz", "parkia-pg-20261113T033000Z.tar.gz.gpg",
  ]) assert.ok(BACKUP_FILE_PATTERN.test(name), name);
});

test("no confunde hashes, carpetas de trabajo ni archivos ajenos con un respaldo", () => {
  for (const name of [
    "parkia-pg-20261113T033000Z.tar.gz.gpg.sha256", "parkia-pg-20261113T033000Z.tar.gz.sha256",
    ".work.AbC123", "parkia-pg-20261113T033000Z.dump", "notas.txt", "parkia-pg-.tar.gzip",
  ]) assert.ok(!BACKUP_FILE_PATTERN.test(name), name);
});
