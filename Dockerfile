FROM ghcr.io/holusion/e-corpus:v0.3.0@sha256:2fe9f4c66260b43133fe8506b5e5a78082b2067daeab5979cc21384f98270d8d
COPY server/ /app/server/
COPY migrations/010-learning.sql /app/migrations/010-learning.sql
COPY migrations/011-learning-release.sql /app/migrations/011-learning-release.sql
COPY migrations/012-learning-workflow.sql /app/migrations/012-learning-workflow.sql
COPY migrations/013-learning-disabled-accounts.sql /app/migrations/013-learning-disabled-accounts.sql
COPY portal/ /app/learning/
