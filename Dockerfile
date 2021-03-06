FROM node:10

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY ./ .

EXPOSE 8080

ENV PORT=8080
ENV NODE_ENV=production
ENV CLIENT_URL=http://localhost:8080
ENV SQL_HOST=db
ENV SQL_USER=root
ENV SQL_PASSWORD=root
ENV SQL_DATABASE=clubhouse
ENV SQL_PORT=3306
ENV CLUB_ID=1

CMD ["node","server.js"]
