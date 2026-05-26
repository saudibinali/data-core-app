import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { UPLOAD_LIMITS } from "./lib/workforce/upload-config";
import { resolveCorsOrigin } from "./lib/cors-settings";
import { isProductionRuntime } from "./lib/security-config";

const app: Express = express();

app.use(
  helmet({
    contentSecurityPolicy: isProductionRuntime() ? undefined : false,
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(cors({ credentials: true, origin: resolveCorsOrigin }));
app.use(cookieParser());
app.use(express.json({ limit: UPLOAD_LIMITS.jsonBodyBytes }));
app.use(express.urlencoded({ extended: true, limit: UPLOAD_LIMITS.jsonBodyBytes }));

app.use("/api", router);

export default app;
