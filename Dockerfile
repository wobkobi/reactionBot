# Debian, not Alpine: onnxruntime-node ships only a glibc build, so voice
# silently fails to load on musl. Trixie over bookworm for newer packages,
# which is where most of the base image's advisories came from.

# ---------------------------------------------------------------- build stage
FROM node:24-trixie-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./

# onnxruntime-node fetches a CUDA provider on linux/x64 that nothing here
# loads, and its extractor carries GHSA-vwc7-r8mq-g2x9 with no fix available.
ENV ONNXRUNTIME_NODE_INSTALL=skip

# simple-git-hooks has nothing to hook here and fails the install. Dropping
# only prepare leaves dependency install scripts alone.
RUN npm pkg delete scripts.prepare \
    && npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# -------------------------------------------------------------- runtime stage
FROM node:24-trixie-slim

# Converts clips that are not already Opus, once each. Drop it if every clip
# you use is .ogg/.opus/.webm.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./

ENV ONNXRUNTIME_NODE_INSTALL=skip

# --omit=dev keeps optionalDependencies, where the voice packages live. A
# platform without a prebuild loses voice rather than failing the build.
RUN npm pkg delete scripts.prepare \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --from=builder /app/build ./build

# Config templates, so a fresh named volume starts with something to copy.
COPY data/readme.md ./data/
COPY data/global/*.example.jsonc ./data/global/
COPY data/sounds/readme.md ./data/sounds/

# Runs unprivileged, so the directory it writes has to be owned by that user.
RUN mkdir -p data && chown -R node:node /app/data

USER node

# Config, counters, clips and the Whisper model cache. Without a volume a
# restart loses the configuration and re-downloads the model.
VOLUME ["/app/data"]

# Baked in so the boot log can say which build is running. A restart that
# quietly kept the previous image is otherwise indistinguishable from one that
# picked up the new one. Last, and after the COPY layers, so changing it does
# not invalidate the cache for anything above.
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA

# Not `npm start`, which would rebuild. index.ts handles SIGTERM, so the bot
# leaves its voice channels on `docker stop` rather than going down mid-call.
CMD ["node", "build/index.js"]
