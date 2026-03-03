import cors from "cors";
import express from "express";
import type { Page } from "playwright-core";
import { scrapeJob } from "./services/scrapeJob";
import { ScrapeJobError } from "./services/scrapeErrors";
import { withBrowser } from "./services/withBrowser";
import { logger } from "./utils/logger";

const app = express();
app.use(cors());
app.use(express.json());

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function installLoginDialogHandlers(page: Page) {
  const state = {
    loginError: false,
    accountLocked: false,
  };

  page.on("dialog", async dialog => {
    if (dialog.type() !== "alert") {
      await dialog.dismiss();
      return;
    }

    const msg = dialog.message();
    logger.info("Dialog message", { message: msg });
    if (msg.includes("연속 5회 잘못 입력하셨습니다")) {
      state.accountLocked = true;
    } else if (msg.includes("아이디 또는 비밀번호를 잘못 입력하셨습니다") || msg.includes("유효하지 않은 사용자입니다")) {
      state.loginError = true;
    }
    await dialog.dismiss();
  });

  return state;
}

app.post("/auth", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "학번/비밀번호가 필요합니다." });
    }

    const portalTimeoutMs = parsePositiveNumber(process.env.PORTAL_TIMEOUT_MS, 60000);
    await withBrowser(async page => {
      const loginState = installLoginDialogHandlers(page);

      await page.goto("https://portal.suwon.ac.kr/enview/index.html", {
        waitUntil: "networkidle",
        timeout: portalTimeoutMs,
      });
      const frame = page.frame({ name: "mainFrame" });
      if (!frame) {
        throw new Error("mainFrame을 찾을 수 없습니다.");
      }

      await frame.fill('input[name="userId"]', username);
      await frame.fill('input[name="pwd"]', password);
      await frame.click("button.mainbtn_login");
      await page.waitForTimeout(3000);

      if (loginState.loginError) {
        throw new Error("아이디나 비밀번호가 일치하지 않습니다.\n학교 홈페이지에서 확인해주세요.");
      }

      if (loginState.accountLocked) {
        throw new Error("계정이 잠겼습니다. 포털사이트로 돌아가서 학번/사번 찾기 및 비밀번호 재발급을 진행해주세요.");
      }
    });

    return res.json({ success: true, message: "로그인 성공" });
  } catch (error) {
    logger.error("Login failed", { error: error instanceof Error ? error.message : String(error) });
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/scrape", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: "학번/비밀번호가 필요합니다." });
  }

  try {
    const result = await scrapeJob({
      username,
      password,
      portalTimeoutMs: parsePositiveNumber(process.env.PORTAL_TIMEOUT_MS, 60000),
    });
    return res.json(result);
  } catch (error) {
    if (error instanceof ScrapeJobError) {
      if (error.errorCode === "PORTAL_AUTH_FAILED") {
        return res.status(401).json({ error: error.message });
      }
      if (error.errorCode === "PORTAL_ACCOUNT_LOCKED") {
        return res.status(423).json({ error: error.message });
      }
      return res.status(500).json({ error: error.message });
    }

    logger.error("@알수 없는 오류", {
      username,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Legacy server is running on port ${PORT}`);
});
