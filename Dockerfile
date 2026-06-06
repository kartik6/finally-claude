# Stage 1: Build Next.js static export
FROM node:20-slim AS node-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend
FROM python:3.12-slim AS final
WORKDIR /app

# Install uv
RUN pip install --no-cache-dir uv

# Copy backend and install dependencies
COPY backend/ ./backend/
RUN cd backend && uv sync --frozen --no-dev

# Copy built frontend static export to /app/static
# (backend resolves static dir at <backend>/../static)
COPY --from=node-builder /app/frontend/out ./static

# Runtime DB directory (volume mount target)
RUN mkdir -p /app/db

EXPOSE 8000

CMD ["uv", "--directory", "backend", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
