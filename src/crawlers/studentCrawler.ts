import type { Page } from "playwright-core";
import type { StudentDTO } from "../dtos/StudentDTO";
import { logger } from "../utils/logger";

const STUDENT_HEADERS = {
  "Content-Type": "application/json;charset=UTF-8",
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0",
  Referer:
    "https://info.suwon.ac.kr/websquare/websquare_mobile.html?w2xPath=/views/usw/sa/hj/SA_HJ_1230.xml&menuSeq=3818&progSeq=1117",
};

export async function scrapeStudent(page: Page, username: string): Promise<StudentDTO> {
  const response = await page.request.post("https://info.suwon.ac.kr/scrgBas/selectScrgBas.do", {
    headers: STUDENT_HEADERS,
    data: { sno: username },
  });
  logger.info(`Student response status:${username}`, response.status());
  if (!response.ok()) {
    logger.error("Failed to fetch student info. Status:", response.status());
    throw new Error(`Failed to fetch student info: ${response.status()}`);
  }
  const responseData = await response.json();
  logger.info(`Student response data keys:${username}`, Object.keys(responseData || {}));
  const studentInfo = responseData?.studentInfo;
  if (!studentInfo) {
    logger.error(`studentInfo:${username}`, responseData);
    logger.error(`No studentInfo found in response:${username}`);
    throw new Error(`No studentInfo found in response:${username}`);
  }
  return {
    sno: studentInfo.sno,
    studNm: studentInfo.studNm,
    univCd: studentInfo.univCd,
    univNm: studentInfo.univNm,
    dpmjCd: studentInfo.dpmjCd,
    dpmjNm: studentInfo.dpmjNm,
    mjorCd: studentInfo.mjorCd,
    mjorNm: studentInfo.mjorNm,
    the2MjorCd: studentInfo.the2MjorCd,
    the2MjorNm: studentInfo.the2MjorNm,
    enscYear: studentInfo.enscYear,
    enscSmrCd: studentInfo.enscSmrCd,
    scrgStatNm: studentInfo.scrgStatNm,
    studGrde: studentInfo.studGrde,
    enscDvcd: studentInfo.enscDvcd,
    facSmrCnt: parseInt(studentInfo.facSmrCnt) || 0,
    flangPassGb: studentInfo.flangPassGb,
  };
}
