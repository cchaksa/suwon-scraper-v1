import type { Page } from "playwright-core";
import { scrapeStudent } from "../crawlers/studentCrawler";
import { scrapeCourses } from "../crawlers/courseCrawler";
import { scrapeCredits } from "../crawlers/creditCrawler";
import { mergeCreditCourse } from "./merge";
import { withBrowser } from "./withBrowser";
import { ScrapeJobError } from "./scrapeErrors";
import { logger } from "../utils/logger";

export interface ScrapeJobParams {
  username: string;
  password: string;
  portalTimeoutMs: number;
  abortSignal?: AbortSignal;
  jobId?: string;
}

export interface ScrapeJobResult {
  student: Awaited<ReturnType<typeof scrapeStudent>>;
  semesters: ReturnType<typeof mergeCreditCourse>;
  academicRecords: Awaited<ReturnType<typeof scrapeCredits>>["gradeResponse"];
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

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ScrapeJobError("PORTAL_TIMEOUT", "작업이 중단되었습니다.", true);
  }
}

export async function scrapeJob(params: ScrapeJobParams): Promise<ScrapeJobResult> {
  const { username, password, portalTimeoutMs, abortSignal, jobId } = params;

  try {
    return await withBrowser(async page => {
      assertNotAborted(abortSignal);
      const loginState = installLoginDialogHandlers(page);

      await page.goto("https://portal.suwon.ac.kr/enview/index.html", {
        waitUntil: "networkidle",
        timeout: portalTimeoutMs,
      });

      const frame = page.frame({ name: "mainFrame" });
      if (!frame) {
        throw new ScrapeJobError("BUSINESS_RULE_VIOLATION", "mainFrame을 찾을 수 없습니다.", false);
      }

      await frame.fill('input[name="userId"]', username);
      await frame.fill('input[name="pwd"]', password);
      await frame.click("button.mainbtn_login");
      await page.waitForTimeout(3000);

      if (loginState.loginError) {
        throw new ScrapeJobError(
          "PORTAL_AUTH_FAILED",
          "아이디나 비밀번호가 일치하지 않습니다.\n학교 홈페이지에서 확인해주세요.",
          false
        );
      }

      if (loginState.accountLocked) {
        throw new ScrapeJobError(
          "PORTAL_ACCOUNT_LOCKED",
          "계정이 잠겼습니다. 포털사이트로 돌아가서 학번/사번 찾기 및 비밀번호 재발급을 진행해주세요.",
          false
        );
      }

      assertNotAborted(abortSignal);

      logger.info("학사시스템 페이지 이동 시작", { job_id: jobId, username });
      await page.goto("https://info.suwon.ac.kr/sso_security_check", {
        waitUntil: "domcontentloaded",
        timeout: portalTimeoutMs,
      });
      logger.info("학사시스템 페이지 이동 완료", { job_id: jobId, username });

      const [student, courses, creditResult] = await Promise.all([
        scrapeStudent(page, username),
        scrapeCourses(page, username),
        scrapeCredits(page, username),
      ]);

      return {
        student,
        semesters: mergeCreditCourse(creditResult.creditDTOs, courses),
        academicRecords: creditResult.gradeResponse,
      };
    }, { abortSignal });
  } catch (error) {
    if (error instanceof ScrapeJobError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("timeout") || message.toUpperCase().includes("ABORT")) {
      throw new ScrapeJobError("PORTAL_TIMEOUT", message, true);
    }

    throw error;
  }
}
