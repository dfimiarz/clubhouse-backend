# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps

WORKDIR /app

# Yarn 4 is pinned via yarnPath; do not rely on the image's global yarn.
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases .yarn/releases

# Prefer node-modules in the image (simpler than PnP for container runtimes).
# Disable global cache so installs stay self-contained in the build.
ENV YARN_ENABLE_GLOBAL_CACHE=false \
    YARN_NODE_LINKER=node-modules \
    YARN_NPM_MINIMAL_AGE_GATE=0 \
    NODE_ENV=production

RUN yarn install --immutable && yarn cache clean --all

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080

# App source (no secrets; see .dockerignore)
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/alive',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
