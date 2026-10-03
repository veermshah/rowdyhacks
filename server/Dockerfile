# Presage's Linux runtime needs glibc >= 2.35; Debian bookworm ships 2.36.
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 5000
CMD ["node", "src/server.js"]
