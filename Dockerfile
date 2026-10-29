FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node . .
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 5000
CMD ["node", "server.js"]
