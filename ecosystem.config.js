// Local dev process definitions. Ports are fixed: API 3433, frontend 3333.
module.exports = {
  apps: [
    {
      name: 'ai-video-api',
      cwd: './backend',
      script: 'npm',
      args: 'start',
      env: { NODE_ENV: 'development' },
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: 'ai-video-web',
      cwd: './frontend',
      script: 'npm',
      args: 'run dev',
      env: { NODE_ENV: 'development' },
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
