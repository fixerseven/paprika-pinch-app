# Pinch on the Mac mini. Build: docker compose build. Run: docker compose up -d.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Dev dependencies stay installed: `npm run import` uses tsx.
RUN npm run build

ENV NODE_ENV=production \
    PINCH_DB_PATH=/data/pinch.db \
    PINCH_ANDAR_ROOT=/brands/andar \
    PINCH_NEST_ROOT=/brands/nest
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
