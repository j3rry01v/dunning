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
        // On ARM64 servers, Puppeteer's bundled Chrome has no Linux ARM64
        // build. Install a system Chromium (`sudo apt-get install chromium`)
        // and point at it here, e.g.:
        // PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium'
      }
    }
  ]
};
