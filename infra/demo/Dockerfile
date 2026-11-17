FROM postgres:15-bookworm@sha256:72ccb1ad4dc9d5813ea40a8c1c87af746f16658fb029c17fe570ea9b881f68b3
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 APP_ENV=demo
WORKDIR /app
COPY backend/requirements.lock ./requirements.lock
RUN pip install --no-cache-dir --require-hashes -r requirements.lock
COPY --chown=postgres:postgres backend/app ./app
COPY --chown=postgres:postgres backend/alembic ./alembic
COPY --chown=postgres:postgres backend/alembic.ini ./alembic.ini
USER postgres
EXPOSE 10000
ENTRYPOINT ["python", "-m", "app.demo_runtime"]
CMD []
