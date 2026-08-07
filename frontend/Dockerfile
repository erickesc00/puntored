FROM node:22-alpine

WORKDIR /app

ARG BACKEND_ORIGIN=http://backend:3000

ENV NEXT_TELEMETRY_DISABLED=1
ENV BACKEND_ORIGIN=$BACKEND_ORIGIN

COPY package.json package-lock.json ./
RUN npm ci

COPY next.config.ts tsconfig.json tsconfig.typecheck.json eslint.config.mjs vitest.config.ts vitest.setup.ts ./
COPY src ./src

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001

CMD ["npm", "run", "start"]
