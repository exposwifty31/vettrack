FROM node:22-alpine

RUN npm install -g pnpm

WORKDIR /app

COPY package*.json pnpm-lock.yaml ./
RUN NODE_ENV=development pnpm install --frozen-lockfile

COPY . .

ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

RUN pnpm build

EXPOSE 5000
CMD ["pnpm", "start"]
