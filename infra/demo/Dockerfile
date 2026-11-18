# Production demo runs only the HTTP API. PostgreSQL lives exclusively in Neon.
FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 APP_ENV=demo
WORKDIR /app
COPY backend/requirements.lock ./requirements.lock
RUN pip install --no-cache-dir --require-hashes -r requirements.lock \
    && groupadd -r bodyvision && useradd -r -g bodyvision -d /app bodyvision
COPY --chown=bodyvision:bodyvision backend/app ./app
USER bodyvision
EXPOSE 10000
ENTRYPOINT ["python", "-m", "app.demo_runtime"]
