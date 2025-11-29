FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY BackEnd/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY BackEnd/ /app

ENV PORT=8000
CMD ["bash", "-lc", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]