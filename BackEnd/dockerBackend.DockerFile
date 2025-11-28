# backend/dockerBackend.dockerfile
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copiamos TODO el backend (incluye main.py y data.csv)
COPY backend/ /app

ENV PORT=8000
CMD ["bash", "-lc", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]