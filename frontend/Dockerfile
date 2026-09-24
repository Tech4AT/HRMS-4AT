# Frontend service image (Next.js). Used by the root docker-compose.yml.
FROM node:20-slim

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3001
# package.json's "start" script already pins -p 3001; appending another -p
# here duplicated the flag (`next start -p 3001 -p 3001` in the container logs).
CMD ["npm", "run", "start"]
