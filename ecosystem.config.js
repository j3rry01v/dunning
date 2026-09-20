module.exports = {
  apps: [
    {
      name: 'dunning',
      script: 'index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production'
        // On Linux ARM64, a system Chromium at a standard path (e.g.
        // /snap/bin/chromium) is auto-detected — no config needed. Only set
        // PUPPETEER_EXECUTABLE_PATH here if yours lives somewhere unusual:
        // PUPPETEER_EXECUTABLE_PATH: '/path/to/chromium'
      }
    }
  ]
};
