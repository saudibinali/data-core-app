/**
 * PM2 ecosystem config for on-premises / bare-metal deployment.
 * Usage: pm2 start deploy/ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: "ops-worker",
      script: "./artifacts/api-server/dist/worker.mjs",
      interpreter: "node",
      interpreter_args: "--enable-source-maps",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        WORKER_MODE: "worker",
      },
      error_file: "./logs/worker-error.log",
      out_file: "./logs/worker-out.log",
      merge_logs: true,
    },
    {
      name: "ops-api",
      script: "./artifacts/api-server/dist/index.mjs",
      interpreter: "node",
      interpreter_args: "--enable-source-maps",
      instances: "max",           // one per CPU core
      exec_mode: "cluster",
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 8080,
        WORKER_MODE: "api",
      },
      // PM2 will read DATABASE_URL, JWT_SECRET, etc. from the system environment
      // or from a .env file referenced with: pm2 start ... --env-file .env
      error_file: "./logs/api-error.log",
      out_file:   "./logs/api-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
