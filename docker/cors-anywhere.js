const proxy = require('cors-anywhere');
const url = require('url');

const serverUrlRaw = process.env.CORS_SERVER || 'http://0.0.0.0:8080';
const serverUrl = url.parse(serverUrlRaw, true);

proxy
  .createServer({
    originWhitelist: [],
    requireHeader: [],
    removeHeaders: ['cookie', 'cookie2'],
    httpProxyOptions: {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }
  })
  .listen(serverUrl.port, serverUrl.hostname, () => {
    console.log(`Running CORS Anywhere on ${serverUrl.hostname}, with port ${serverUrl.port}`);
  });