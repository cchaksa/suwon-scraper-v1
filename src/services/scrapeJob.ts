import { scrapeStudent } from "../crawlers/studentCrawler";
import { scrapeCourses } from "../crawlers/courseCrawler";
import { scrapeCredits } from "../crawlers/creditCrawler";
import { mergeCreditCourse } from "./merge";
import { withBrowser } from "./withBrowser";
import { ScrapeJobError } from "./scrapeErrors";
import { loginToPortalSession } from "./portalLogin";

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

export async function scrapeJob(params: ScrapeJobParams): Promise<ScrapeJobResult> {
  const { username, password, portalTimeoutMs, abortSignal, jobId } = params;

  try {
    return await withBrowser(async page => {
      await loginToPortalSession(page, { username, password, portalTimeoutMs, abortSignal, jobId });

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
