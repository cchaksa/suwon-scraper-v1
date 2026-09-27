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

export async function scrapeDesignatedCourses(
  page: Page,
  username: string,
  orgClsCd: string | undefined
): Promise<DesignatedCourseDTO[]> {
  if (typeof orgClsCd !== "string" || orgClsCd.trim() === "") {
    throw new ScrapeJobError(
      "PORTAL_RESPONSE_SCHEMA_MISMATCH",
      "학생 정보의 orgClsCd가 없거나 유효한 문자열이 아닙니다.",
      false
    );
  }

  const response = await page.request.post("https://info.suwon.ac.kr/precpSbjt/listPrecpSbjt.do", {
    headers: DESIGNATED_COURSE_HEADERS,
    data: { sno: username, orgClsCd },
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

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ScrapeJobError(
      "PORTAL_RESPONSE_SCHEMA_MISMATCH",
      "지정과목 응답을 JSON으로 해석할 수 없습니다.",
      false
    );
  }

  if (!data || typeof data !== "object" || !("precpSbjtList" in data) || !Array.isArray(data.precpSbjtList)) {
    throw new ScrapeJobError(
      "PORTAL_RESPONSE_SCHEMA_MISMATCH",
      "지정과목 응답의 precpSbjtList가 배열이 아닙니다.",
      false
    );
  }

  return data.precpSbjtList;
}
