FROM node:22-alpine
RUN apk add --no-cache openssl python3 make g++ certbot
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 4000
CMD ["node", "index.js"]
