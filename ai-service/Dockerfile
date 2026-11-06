FROM python:3.12-slim AS builder
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim AS runner
RUN groupadd --system fluxgate && useradd --system --gid fluxgate --no-create-home fluxgate

COPY --from=builder /install /usr/local

WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Models stay root-owned and read-only: joblib files execute code when loaded.
COPY *.py ./
COPY models ./models

USER fluxgate
EXPOSE 8090

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"HEALTH_PORT\", \"8090\")}/health', timeout=4)" || exit 1

# Runs as PID 1, and consumer.py installs its own SIGTERM handler.
CMD ["python", "consumer.py"]
