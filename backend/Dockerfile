# Backend container for Render / Cloud Run.
# Build context: backend/ (run from the backend directory).
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
# Schema migrations and operational scripts (run with `python -m alembic ...`).
COPY alembic.ini ./alembic.ini
COPY alembic ./alembic
COPY scripts ./scripts
COPY data ./data

# Cloud Run / Render set PORT; default to 8000 for local Docker runs.
ENV PORT=8000
EXPOSE $PORT

# Bind to 0.0.0.0 so the platform can route traffic into the container. Run ONE
# process: live connections and rate limits live in memory.
CMD exec uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'
