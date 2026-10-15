# Image pour Railway, un VPS ou tout hébergeur qui fait tourner des conteneurs.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
# CRM SQLite et session WhatsApp : à monter sur un volume persistant.
ENV DATA_DIR=/data WA_AUTH_DIR=/data/auth
VOLUME /data
CMD ["npm", "start"]
