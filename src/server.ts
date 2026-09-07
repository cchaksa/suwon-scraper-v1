import cors from "cors";
import express, { type Response } from "express";
import { scrapeJob } from "./services/scrapeJob";
import { ScrapeJobError } from "./services/scrapeErrors";
import { verifyPortalLogin, type PortalLoginFn } from "./services/portalLogin";
import { logger } from "./utils/logger";

type ScrapeFn = typeof scrapeJob;

export interface ServerDeps {
  loginFn?: PortalLoginFn;
  scrapeFn?: ScrapeFn;
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sendPortalError(res: Response, error: unknown) {
  if (error instanceof ScrapeJobError) {
    if (error.errorCode === "PORTAL_AUTH_FAILED") {
      return res.status(401).json({ error: error.message });
    }
    if (error.errorCode === "PORTAL_ACCOUNT_LOCKED") {
      return res.status(423).json({ error: error.message });
    }
    return res.status(500).json({ error: error.message });
  }

  return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
}

export function createApp(deps: ServerDeps = {}) {
  const app = express();
  const loginFn = deps.loginFn ?? verifyPortalLogin;
  const scrapeFn = deps.scrapeFn ?? scrapeJob;

  app.use(cors());
  app.use(express.json());

  app.post("/login", async (req, res) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ error: "학번/비밀번호가 필요합니다." });
    }

    try {
      await loginFn({
        username,
        password,
        portalTimeoutMs: parsePositiveNumber(process.env.PORTAL_TIMEOUT_MS, 60000),
      });
      return res.status(204).send();
    } catch (error) {
      logger.error("Login validation failed", { error: error instanceof Error ? error.message : String(error) });
      return sendPortalError(res, error);
    }
  });

  app.post("/auth", async (req, res) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ error: "학번/비밀번호가 필요합니다." });
    }

    try {
      await loginFn({
        username,
        password,
        portalTimeoutMs: parsePositiveNumber(process.env.PORTAL_TIMEOUT_MS, 60000),
      });
      return res.json({ success: true, message: "로그인 성공" });
    } catch (error) {
      logger.error("Login failed", { error: error instanceof Error ? error.message : String(error) });
      return sendPortalError(res, error);
    }
  });

  app.post("/scrape", async (req, res) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ error: "학번/비밀번호가 필요합니다." });
    }

    try {
      const result = await scrapeFn({
        username,
        password,
        portalTimeoutMs: parsePositiveNumber(process.env.PORTAL_TIMEOUT_MS, 60000),
      });
      return res.json(result);
    } catch (error) {
      logger.error("@알수 없는 오류", {
        username,
        error: error instanceof Error ? error.message : String(error),
      });
      return sendPortalError(res, error);
    }
  });

  app.get("/health", (req, res) => {
    res.status(200).send("OK");
  });

  return app;
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  createApp().listen(PORT, () => {
    logger.info(`Legacy server is running on port ${PORT}`);
  });
}
