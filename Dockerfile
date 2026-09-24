FROM node:24-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /provider-data && chown node:node /provider-data

EXPOSE 8080
USER node
CMD ["node", "src/server.js"]
