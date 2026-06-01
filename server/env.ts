export function getParkiaEnv(primaryName: string, legacyName: string, fallback: string) {
  return process.env[primaryName] || process.env[legacyName] || fallback;
}

export function getParkiaSeedDemoSetting() {
  return process.env.PARKIA_SEED_DEMO ?? process.env.TIOLUCHIN_SEED_DEMO;
}
