# Container image. Mount a persistent volume at /data and pass MASTER_KEY as a secret.
#   docker build -t guardora .
#   docker run -d --restart=always -p 8787:8787 -v guardora-data:/data -e MASTER_KEY=... -e NODE_ENV=production guardora
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY tools ./tools
RUN mkdir /data && chown node:node /data
ENV DATA_DIR=/data PORT=8787
USER node
EXPOSE 8787
CMD ["node", "server/index.js"]
