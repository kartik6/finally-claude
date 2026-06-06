#!/bin/bash
set -e

# Resolve project root (parent of this script's directory) so the script
# works regardless of the directory it is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

CONTAINER_NAME="finally-app"
IMAGE_NAME="finally"
PORT=8000

# Parse args
BUILD=false
OPEN_BROWSER=false
for arg in "$@"; do
  case $arg in
    --build) BUILD=true ;;
    --open) OPEN_BROWSER=true ;;
  esac
done

# Build image if needed or --build flag
if [[ "$BUILD" == "true" ]] || ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
  echo "Building Docker image..."
  docker build -t "$IMAGE_NAME" .
fi

# Stop existing container if running
if docker ps -aq -f name="^${CONTAINER_NAME}$" | grep -q .; then
  echo "Removing existing container..."
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

# Check .env exists
if [ ! -f .env ]; then
  echo "Warning: .env file not found. Copying from .env.example..."
  cp .env.example .env
  echo "Please edit .env with your API keys."
fi

# Run container
echo "Starting FinAlly..."
docker run -d \
  --name "$CONTAINER_NAME" \
  -p "$PORT:8000" \
  -v finally-data:/app/db \
  --env-file .env \
  "$IMAGE_NAME"

echo ""
echo "FinAlly is running at: http://localhost:$PORT"
echo ""

if [[ "$OPEN_BROWSER" == "true" ]]; then
  sleep 2
  open "http://localhost:$PORT"
fi
