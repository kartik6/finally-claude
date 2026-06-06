#!/bin/bash
set -e

CONTAINER_NAME="finally-app"

if docker ps -aq -f name="^${CONTAINER_NAME}$" | grep -q .; then
  echo "Stopping FinAlly..."
  docker rm -f "$CONTAINER_NAME" >/dev/null
  echo "Stopped. (Data volume 'finally-data' is preserved.)"
else
  echo "FinAlly is not running."
fi
