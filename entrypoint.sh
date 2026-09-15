#!/bin/sh
set -e

DATA_DIRECTORY="${DATA_DIR:-/data}"

# Ensure data directory exists
mkdir -p "$DATA_DIRECTORY"

# If started as root, fix volume permissions and drop privileges
if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-1000}"
  PGID="${PGID:-1000}"

  # Fix ownership of data directory for mounted host volumes
  chown -R "$PUID:$PGID" "$DATA_DIRECTORY" 2>/dev/null || true
  chmod 775 "$DATA_DIRECTORY" 2>/dev/null || true

  # Execute application dropping privileges to PUID:PGID
  exec su-exec "$PUID:$PGID" "$@"
fi

# If already running as non-root user (e.g. docker run --user ...)
exec "$@"
