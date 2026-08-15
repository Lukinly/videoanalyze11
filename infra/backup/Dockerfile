FROM postgres:16-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends age ca-certificates curl postgresql-client \
  && curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc \
  && chmod +x /usr/local/bin/mc \
  && rm -rf /var/lib/apt/lists/*

COPY scripts/backup-database.sh /usr/local/bin/backup-database
RUN chmod +x /usr/local/bin/backup-database

CMD ["/bin/bash", "-c", "while true; do /usr/local/bin/backup-database; sleep 86400; done"]
