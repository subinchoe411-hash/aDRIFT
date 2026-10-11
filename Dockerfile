FROM node:22-slim
WORKDIR /app
COPY package.json index.html online.js admin.html ./
COPY server ./server
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server/server.js"]
