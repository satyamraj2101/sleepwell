import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

/**
 * 🛠️ Dynamic Path Proxy Architecture
 * The proxy extracts the target instance from the first segment of the path.
 * Path: /leah-new-api/{instance}.azurewebsites.net/api/...
 * This allows a single running server to handle multiple Leah instances dynamically.
 */

// 1. Old Prod API Proxy
app.use('/leah-old-api', createProxyMiddleware({
  target: 'https://cloudstaging5.contractpod.com',
  changeOrigin: true,
  secure: true,
  router: (req) => {
    const m = req.url.match(/^\/([^/]+)/);
    if (m) return `https://${m[1]}`;
  },
  pathRewrite: (path, req) => {
    // Express strips the /leah-old-api mount prefix, so path = /{instance}/...
    // Remove the instance segment and prepend /cpaimt_api
    return path.replace(/^\/[^/]+/, '/cpaimt_api');
  },
  onProxyReq: (proxyReq, req) => {
    const m = req.url.match(/^\/([^/]+)/);
    if (m) proxyReq.setHeader('host', m[1]);
  }
}));

// 2. New Cloud API Proxy
app.use('/leah-new-api', createProxyMiddleware({
  target: 'https://cpai-productapi-stg5.azurewebsites.net',
  changeOrigin: true,
  secure: true,
  router: (req) => {
    const m = req.url.match(/^\/([^/]+)/);
    if (m) return `https://${m[1]}`;
  },
  pathRewrite: (path, req) => {
    // Express strips the /leah-new-api mount prefix, so path = /{instance}/...
    // Remove the instance segment, leaving /api/...
    return path.replace(/^\/[^/]+/, '');
  },
  onProxyReq: (proxyReq, req) => {
    const m = req.url.match(/^\/([^/]+)/);
    if (m) proxyReq.setHeader('host', m[1]);
  }
}));

// 3. Auth API Proxy
app.use('/leah-auth', createProxyMiddleware({
  target: 'https://cloudstaging5.contractpod.com',
  changeOrigin: true,
  secure: true,
  router: (req) => {
    const m = req.url.match(/^\/([^/]+)/);
    if (m) return `https://${m[1]}`;
  },
  pathRewrite: (path, req) => {
    // Express strips the /leah-auth mount prefix, so path = /{instance}/...
    // Remove the instance segment and prepend /cpaimt_auth
    return path.replace(/^\/[^/]+/, '/cpaimt_auth');
  },
  onProxyReq: (proxyReq, req) => {
    const m = req.url.match(/^\/([^/]+)/);
    if (m) proxyReq.setHeader('host', m[1]);
  }
}));

// Serve static assets from dist
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Leah Toolkit production server running on port ${PORT}`);
  console.log(`- Dynamic Proxy /leah-old-api/{instance} -> Instance cpaimt_api`);
  console.log(`- Dynamic Proxy /leah-new-api/{instance} -> Instance API`);
  console.log(`- Dynamic Proxy /leah-auth/{instance}    -> Instance cpaimt_auth`);
});
