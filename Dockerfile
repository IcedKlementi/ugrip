FROM node:12.16.1

COPY package.json package.json
COPY yarn.lock yarn.lock

RUN yarn install

COPY public/ public/
COPY src/ src/

ARG CORS_SERVER
ENV REACT_APP_CORS_SERVER http://localhost:5001
ENV CORS_SERVER http://0.0.0.0:5001/

RUN PUBLIC_URL=/ yarn build

COPY docker/start.sh start.sh
COPY docker/cors-anywhere.js cors-anywhere.js

RUN sed -i 's/\r//' start.sh

CMD [ "sh", "start.sh" ]
