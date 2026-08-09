// 편입생 지정과목 API를 호출해 선이수 과목 배열을 반환하는 크롤러
import type { Page } from "playwright-core";
import type { DesignatedCourseDTO } from "../dtos/DesignatedCourseDTO";
import { ScrapeJobError } from "../services/scrapeErrors";
import { logger } from "../utils/logger";

const DESIGNATED_COURSE_HEADERS = {
  "Content-Type": "application/json;charset=UTF-8",
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0",
  Referer:
    "https://info.suwon.ac.kr/websquare/websquare_mobile.html?w2xPath=/views/usw/sa/hj/SA_HJ_1230.xml&menuSeq=3818&progSeq=1117",
};

export async function scrapeDesignatedCourses(page: Page, username: string): Promise<DesignatedCourseDTO[]> {
  const response = await page.request.post("https://info.suwon.ac.kr/precpSbjt/listPrecpSbjt.do", {
    headers: DESIGNATED_COURSE_HEADERS,
    data: { sno: username },
  });

  logger.info(`Designated course response status:${username}`, response.status());
  if (!response.ok()) {
    logger.error(`Failed to fetch designated courses:${username}`, response.status());
    if (response.status() >= 500 && response.status() < 600) {
      throw new ScrapeJobError(
        "PORTAL_TEMPORARY_UNAVAILABLE",
        `Failed to fetch designated courses: ${response.status()}`,
        true
      );
    }
    throw new Error(`Failed to fetch designated courses: ${response.status()}`);
  }

  const data = await response.json();
  return Array.isArray(data?.listPrecpSbjt) ? data.listPrecpSbjt : [];
}
