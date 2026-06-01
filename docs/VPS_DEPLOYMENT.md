# Deploy VPS para Parkia

Esta guia prepara una instalacion simple en un VPS Ubuntu. Sirve para Hetzner, OVH, Contabo, Oracle o cualquier proveedor similar.

## Perfil minimo recomendado

- Ubuntu 24.04 LTS.
- 2 vCPU.
- 4 GB RAM.
- 40 GB disco.
- Acceso SSH con llave.
- Dominio apuntando al servidor.

Para demo funcional real, no bajar de 4 GB RAM. El sistema puede correr con menos, pero builds, backups y carga de archivos quedan mas fragiles.

## Arquitectura

- Node.js ejecuta API y frontend compilado.
- nginx termina HTTP/HTTPS y reenvia a `127.0.0.1:8080`.
- systemd mantiene la app levantada.
- SQLite vive en `/var/lib/parkia/parkia.db`.
- Archivos viven en `/var/lib/parkia/storage`.
- Backups viven en `/var/backups/parkia`.

## Instalacion base

```bash
sudo apt update
sudo apt install -y git nginx sqlite3 curl ca-certificates build-essential python3

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

sudo useradd --system --create-home --home-dir /opt/parkia --shell /usr/sbin/nologin parkia
sudo mkdir -p /opt/parkia/releases /opt/parkia/current
sudo mkdir -p /var/lib/parkia/storage /var/backups/parkia /etc/parkia
sudo chown -R parkia:parkia /opt/parkia /var/lib/parkia /var/backups/parkia
```

## Codigo

```bash
sudo -u parkia git clone <URL_DEL_REPOSITORIO_PARKIA> /opt/parkia/current
cd /opt/parkia/current
sudo -u parkia npm ci --omit=dev
sudo -u parkia npm run build
```

`tsx` queda como dependencia de runtime porque `npm start` ejecuta `server.ts` directamente.

## Variables de entorno

Crear `/etc/parkia/parkia.env`:

```bash
NODE_ENV=production
APP_URL=https://app.parkia.cl
TRUSTED_ORIGINS=
PORT=8080
HOST=127.0.0.1
PARKIA_DB_PATH=/var/lib/parkia/parkia.db
PARKIA_STORAGE_PATH=/var/lib/parkia/storage
PARKIA_BACKUP_PATH=/var/backups/parkia
PARKIA_SEED_DEMO=false
```

Permisos:

```bash
sudo chown root:parkia /etc/parkia/parkia.env
sudo chmod 640 /etc/parkia/parkia.env
```

## systemd

```bash
sudo cp deploy/systemd/parkia.service /etc/systemd/system/parkia.service
sudo systemctl daemon-reload
sudo systemctl enable --now parkia
sudo systemctl status parkia
```

Logs:

```bash
sudo journalctl -u parkia -f
```

## nginx y HTTPS

```bash
sudo bash scripts/setup-https-nginx.sh app.parkia.cl admin@parkia.cl
```

El script usa nginx + Let's Encrypt/Certbot. Instala el sitio, emite el certificado publico, fuerza redireccion HTTP a HTTPS y habilita renovacion automatica con `certbot.timer`.

Cambiar `app.parkia.cl` por el dominio real y `admin@parkia.cl` por un correo operativo antes de ejecutarlo.

Si primero se quiere probar contra el entorno staging de Let's Encrypt:

```bash
sudo CERTBOT_STAGING=true bash scripts/setup-https-nginx.sh app.parkia.cl admin@parkia.cl
```

Staging instala un certificado de prueba no confiable para navegador. Si ese ensayo pasa, emitir el certificado real inmediatamente despues:

```bash
sudo CERTBOT_FORCE_RENEWAL=true bash scripts/setup-https-nginx.sh app.parkia.cl admin@parkia.cl
```

Validacion:

```bash
curl -fsS https://app.parkia.cl/api/health
sudo systemctl list-timers certbot.timer
```

## Backup diario

```bash
sudo cp deploy/cron/parkia-backup /etc/cron.d/parkia-backup
sudo chmod 644 /etc/cron.d/parkia-backup
```

Probar manualmente:

```bash
sudo -u parkia /opt/parkia/current/scripts/backup-sqlite.sh
sudo -u parkia /opt/parkia/current/scripts/backup-data.sh
ls -lh /var/backups/parkia
```

La rutina deja un respaldo SQLite liviano y un respaldo completo `.tar.gz` con SQLite mas `storage`. Elimina copias de mas de 30 dias.

## Actualizacion

```bash
cd /opt/parkia/current
sudo -u parkia git pull --ff-only origin main
sudo -u parkia npm ci --omit=dev
sudo -u parkia npm run build
sudo systemctl restart parkia
curl -fsS https://app.parkia.cl/api/health
```

Antes de actualizar en operacion real, crear respaldo:

```bash
sudo -u parkia /opt/parkia/current/scripts/backup-sqlite.sh
```

## Checklist de salida

- Dominio resuelve al VPS.
- HTTPS activo.
- `/api/health` responde `status: "ok"`.
- `readiness.productionReady` esta en `true`.
- Admin inicial cambio clave.
- `PARKIA_SEED_DEMO=false`.
- Backup manual probado.
- Backup cron instalado.
- Login probado con `admin`, `finance` y `guard`.
