FROM node:22.13.1-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Install debugging tools
RUN apk add --no-cache curl

EXPOSE 3000
CMD ["npm", "start"]
