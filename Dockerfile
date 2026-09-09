# Debian rather than Alpine on purpose: onnxruntime-node (pulled in by
# @huggingface/transformers for speech recognition) ships one glibc
# libonnxruntime.so per architecture and no musl build, so voice silently
# fails to load on Alpine. linux/x64 and linux/arm64 are both provided.
#
# Trixie (Debian 13) rather than bookworm (12) for the newer packages, which is
# most of the difference in what a scanner reports against the base: glibc 2.41
# against 2.36, ffmpeg 7.1 against 5.1. glibc is backward compatible, so
# onnxruntime's prebuilt binary is unaffected by the newer one.

# ---------------------------------------------------------------- build stage
FROM node:24-trixie-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./

# simple-git-hooks has nothing to hook in a container and would fail the
# install outright; dropping the prepare script leaves dependency install
# scripts alone, which onnxruntime-node needs to place its binaries.
# onnxruntime-node's postinstall downloads and extracts the CUDA 12 execution
# provider on linux/x64, which is this image's platform and the only one it
# does that for. Nothing here uses CUDA - transcription runs on the CPU - so it
# is a large download for a binary that never loads.
#
# Skipping it also takes adm-zip out of the picture. That is the package behind
# GHSA-vwc7-r8mq-g2x9, which has no patched version: extraction follows a
# symlink already present at the destination, and this postinstall extracts
# into a predictable directory under /tmp with overwrite enabled. A build
# container is a poor place to exploit that, being single-user with a fresh
# /tmp, but not running the code at all beats reasoning about who can write
# where.
ENV ONNXRUNTIME_NODE_INSTALL=skip

RUN npm pkg delete scripts.prepare \
    && npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# -------------------------------------------------------------- runtime stage
FROM node:24-trixie-slim

# ffmpeg converts sound clips that are not already Ogg Opus, once each, and
# caches the result. Drop this line if every clip you use is .ogg/.opus.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./

# --omit=dev keeps optionalDependencies, which is where the voice packages live.
# A platform without a prebuild degrades to voice being off rather than failing
# the build, which is why they are optional in the first place.
# onnxruntime-node's postinstall downloads and extracts the CUDA 12 execution
# provider on linux/x64, which is this image's platform and the only one it
# does that for. Nothing here uses CUDA - transcription runs on the CPU - so it
# is a large download for a binary that never loads.
#
# Skipping it also takes adm-zip out of the picture. That is the package behind
# GHSA-vwc7-r8mq-g2x9, which has no patched version: extraction follows a
# symlink already present at the destination, and this postinstall extracts
# into a predictable directory under /tmp with overwrite enabled. A build
# container is a poor place to exploit that, being single-user with a fresh
# /tmp, but not running the code at all beats reasoning about who can write
# where.
ENV ONNXRUNTIME_NODE_INSTALL=skip

RUN npm pkg delete scripts.prepare \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --from=builder /app/build ./build

# Config templates, so a fresh named volume starts with something to copy.
COPY data/readme.md ./data/
COPY data/global/*.example.jsonc ./data/global/
COPY data/sounds/readme.md ./data/sounds/

# The bot reads and writes data/ relative to its working directory, and runs
# unprivileged, so the directory has to be owned by the user that writes it.
RUN mkdir -p data && chown -R node:node /app/data

USER node

# Per-guild config and counters, the sound clips, and the downloaded Whisper
# model (a few hundred MB) all live here. Without a volume every restart loses
# the configuration and re-downloads the model.
VOLUME ["/app/data"]

# Not `npm start`: that rebuilds from source, which is already done above.
# index.ts installs SIGINT/SIGTERM handlers, so the bot leaves its voice
# channels and stops the transcription worker on `docker stop` rather than
# being killed and leaving a ghost connection behind.
CMD ["node", "build/index.js"]
