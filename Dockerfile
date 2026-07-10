FROM node:22-alpine

RUN npm install -g pnpm

WORKDIR /app

COPY package*.json pnpm-lock.yaml ./
RUN NODE_ENV=development pnpm install --frozen-lockfile

COPY . .

ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

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
