// pm2 config. Run `npm run build` before (re)starting - pm2 runs the compiled
// output, and the app loads .env itself via dotenv from the working directory.
module.exports = {
  apps: [
    {
      name: "reactionbot",
      script: "build/index.js",
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: "300M",
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
