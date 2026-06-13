FROM node:22-alpine

WORKDIR /home/node/app

COPY . .

RUN yarn install --frozen-lockfile --production && yarn cache clean

CMD ["yarn", "start"]

EXPOSE 8080
