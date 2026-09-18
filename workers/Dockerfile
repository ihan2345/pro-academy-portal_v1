FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY workers ./workers
COPY scripts/camp/stripe-review-lib.mjs ./scripts/camp/stripe-review-lib.mjs
RUN ./node_modules/.bin/esbuild workers/job-runner.ts --bundle --platform=node --target=node24 --format=cjs --conditions=react-server --outfile=output/runner.cjs

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/output/runner.cjs ./runner.cjs
RUN mkdir -p /app/output/mail && chown -R node:node /app/output
ENV NODE_OPTIONS=--conditions=react-server
EXPOSE 3001
USER node
CMD ["node","runner.cjs"]
