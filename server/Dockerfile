# Presage's Linux runtime needs glibc >= 2.35; Debian bookworm ships 2.36.
FROM node:24-bookworm-slim
# ca-certificates: the slim image has no CA bundle; Presage calls its auth/model
#   servers over HTTPS (libcurl expects /etc/ssl/certs/ca-certificates.crt).
# libvulkan1 + mesa-vulkan-drivers: Presage's expressions model needs Vulkan.
#   Render has no GPU, so use Mesa's CPU implementation (lavapipe).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libvulkan1 mesa-vulkan-drivers \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 5000
CMD ["node", "src/server.js"]
