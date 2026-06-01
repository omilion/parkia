# Hetzner CX23 Deployment

Guia concreta para levantar Parkia en un VPS Hetzner CX23.

## Perfil del servidor

- Plan: CX23.
- CPU: x86 Intel/AMD.
- Sistema operativo: Ubuntu 24.04 LTS.
- Firewall Hetzner:
  - `22/tcp`: solo tu IP.
  - `80/tcp`: publico.
  - `443/tcp`: publico.
- Backups Hetzner: activados.
- Snapshot manual: antes de cada despliegue grande.

No usar ARM para el primer despliegue. El proyecto usa dependencias nativas de Node y x86 reduce riesgo operacional.

## Dominio

Apuntar el dominio o subdominio al IPv4 del VPS:

```txt
app.parkia.cl A <IPv4-del-servidor>
```

Cambiar `app.parkia.cl` por el dominio real antes de configurar `APP_URL`, nginx y certbot.

## Rutas productivas

```txt
/opt/parkia/current                  codigo actual
/etc/parkia/parkia.env               variables de entorno
/var/lib/parkia/parkia.db            base SQLite
/var/lib/parkia/storage              documentos y adjuntos
/var/backups/parkia                  respaldos
```

## Variables recomendadas

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

`HOST=127.0.0.1` es intencional: nginx expone HTTPS y Node queda privado dentro del VPS.

## Instalacion rapida

Seguir [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md). Esa guia ya incluye:

- instalacion de Node 22;
- usuario de sistema `parkia`;
- nginx;
- systemd;
- certbot;
- backup diario de SQLite;
- backup diario completo de SQLite mas `storage`.

Cuando el DNS ya apunte al VPS, emitir HTTPS con:

```bash
cd /opt/parkia/current
sudo bash scripts/setup-https-nginx.sh app.parkia.cl admin@parkia.cl
```

El script instala nginx/Certbot, pide el certificado publico de Let's Encrypt, deja redireccion HTTP -> HTTPS y habilita renovacion automatica.

## Comandos de operacion

Estado del servicio:

```bash
sudo systemctl status parkia
sudo journalctl -u parkia -f
```

Actualizar:

```bash
cd /opt/parkia/current
sudo -u parkia git pull --ff-only origin main
sudo -u parkia npm ci --omit=dev
sudo -u parkia npm run build
sudo systemctl restart parkia
curl -fsS https://app.parkia.cl/api/health
```

Backup manual:

```bash
sudo -u parkia /opt/parkia/current/scripts/backup-sqlite.sh
sudo -u parkia /opt/parkia/current/scripts/backup-data.sh
ls -lh /var/backups/parkia
```

## Criterio para subir de plan

Mantener CX23 si:

- RAM usada estable bajo 70%;
- disco usado bajo 70%;
- `/api/health` responde estable;
- el build corre sin quedarse sin memoria;
- los respaldos completan cada dia.

Subir a CX33 o superior si:

- hay lentitud diaria con varios usuarios;
- los reportes financieros tardan demasiado;
- el storage crece rapido;
- el build o backup empieza a fallar por recursos.
