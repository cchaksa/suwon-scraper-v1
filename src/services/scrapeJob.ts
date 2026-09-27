import type { Page } from "playwright-core";
import { scrapeStudent } from "../crawlers/studentCrawler";
import { scrapeCourses } from "../crawlers/courseCrawler";
import { scrapeCredits } from "../crawlers/creditCrawler";
import { scrapeDesignatedCourses } from "../crawlers/designatedCourseCrawler";
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
  designatedCourses: Awaited<ReturnType<typeof scrapeDesignatedCourses>>;
}

export interface ScrapeDataDeps {
  scrapeStudent: typeof scrapeStudent;
  scrapeCourses: typeof scrapeCourses;
  scrapeCredits: typeof scrapeCredits;
  scrapeDesignatedCourses: typeof scrapeDesignatedCourses;
}

const defaultScrapeDataDeps: ScrapeDataDeps = {
  scrapeStudent,
  scrapeCourses,
  scrapeCredits,
  scrapeDesignatedCourses,
};

export async function scrapeAuthenticatedData(
  page: Page,
  username: string,
  deps: ScrapeDataDeps = defaultScrapeDataDeps
): Promise<ScrapeJobResult> {
  const studentPromise = deps.scrapeStudent(page, username);
  const designatedCoursesPromise = studentPromise.then(student =>
    student.enscDvcd === "2" ? deps.scrapeDesignatedCourses(page, username) : []
  );

  const [student, courses, creditResult, designatedCourses] = await Promise.all([
    studentPromise,
    deps.scrapeCourses(page, username),
    deps.scrapeCredits(page, username),
    designatedCoursesPromise,
  ]);

  return {
    student,
    semesters: mergeCreditCourse(creditResult.creditDTOs, courses),
    academicRecords: creditResult.gradeResponse,
    designatedCourses,
  };
}

export async function scrapeJob(params: ScrapeJobParams): Promise<ScrapeJobResult> {
  const { username, password, portalTimeoutMs, abortSignal, jobId } = params;

  try {
    return await withBrowser(async page => {
      await loginToPortalSession(page, { username, password, portalTimeoutMs, abortSignal, jobId });
      return scrapeAuthenticatedData(page, username);
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
