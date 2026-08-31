FROM node:22-alpine

# Pin to package.json's `packageManager` — an unpinned install grabs the latest
# pnpm (10.x), which rejects the v9 lockfile ("Cannot verify the identity of the
# @pnpm/exe.linux-x64 native binary") and has broken every main deploy since 2026-08-04.
RUN npm install -g pnpm@9.15.9

WORKDIR /app

COPY package*.json pnpm-lock.yaml ./
RUN NODE_ENV=development pnpm install --frozen-lockfile

COPY . .

ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

# Read by src/instrument.ts, which gates Sentry.init on it. Vite inlines it at BUILD
# time, so a value set only on the Railway service reaches the container but not this
# stage — that is how the web app shipped crash-blind on 2026-08-31.
ARG VITE_SENTRY_DSN
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN

# Mainline image builds default to full platform. Pass ALLOW_EQUIPMENT_PILOT_MODE=true
# and VITE_PILOT_MODE=true only for dedicated equipment-pilot images.
ARG ALLOW_EQUIPMENT_PILOT_MODE=false
ARG VITE_PILOT_MODE=false
ENV ALLOW_EQUIPMENT_PILOT_MODE=$ALLOW_EQUIPMENT_PILOT_MODE
ENV VITE_PILOT_MODE=$VITE_PILOT_MODE

# Railway service vars can set VITE_PILOT_MODE=true; mainline images must still build full platform.
RUN if [ "$ALLOW_EQUIPMENT_PILOT_MODE" != "true" ]; then export VITE_PILOT_MODE=false; fi && pnpm build

EXPOSE 8080
CMD ["pnpm", "start"]
