FROM node:21.6-alpine

WORKDIR /home/node/app

COPY . .

RUN yarn install --frozen-lockfile --production && yarn cache clean

CMD ["yarn", "start"]

EXPOSE 8080
