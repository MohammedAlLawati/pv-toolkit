#!/bin/sh
# Daily backup of the database (run from the project folder; see DEPLOY.md for the cron line).
# Keeps the last 30 copies in ./backups.
set -e
cd "$(dirname "$0")"
mkdir -p backups
STAMP=$(date +%Y-%m-%d_%H%M)
docker compose exec -T app sqlite3 /data/app.db ".backup '/data/backup-tmp.db'"
gzip -c data/backup-tmp.db > "backups/app-$STAMP.db.gz"
rm -f data/backup-tmp.db
ls -1t backups/app-*.db.gz | tail -n +31 | xargs -r rm --
echo "Backup written: backups/app-$STAMP.db.gz"
