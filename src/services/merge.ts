// suwon-scraper/src/services/merge.ts

import type { CreditDTO } from "../dtos/CreditDTO";
import type { CourseDTO } from "../dtos/CourseDTO";
import type { MergedSemesterDTO, MergedSemesterCourseDTO } from "../dtos/MergedSemesterDTO";
import { logger } from "../utils/logger";

/**
 * CreditDTO와 CourseDTO 데이터를 학기별로 병합하여 MergedSemesterDTO 배열로 반환한다.
 *
 * - 각 학기는 "YYYY-SS" 형식의 키로 그룹화한다.
 * - 같은 학기에 해당하는 성적과 수강 데이터가 있다면, 동일 과목(예: subjtCd 기준)끼리 병합한다.
 */
export function mergeCreditCourse(creditDTOs: CreditDTO[], courseDTOs: CourseDTO[]): MergedSemesterDTO[] {
  // 학기별로 병합 결과를 저장할 맵 (키: "년도-학기코드")
  const semesterMap: Record<string, { semester: string; courses: Record<string, MergedSemesterCourseDTO> }> = {};
  const originalCoursePoints: Record<string, Record<string, number | null>> = {};

  // 1. 수강 내역(CourseDTO)을 학기별로 그룹화
  for (const course of courseDTOs) {
    const semesterKey = `${course.subjtEstbYear}-${course.subjtEstbSmrCd}`;
    if (!semesterMap[semesterKey]) {
      semesterMap[semesterKey] = { semester: semesterKey, courses: {} };
    }
    if (!originalCoursePoints[semesterKey]) {
      originalCoursePoints[semesterKey] = {};
    }
    // 과목 코드(subjtCd)를 기준으로 초기 값을 저장
    semesterMap[semesterKey].courses[course.subjtCd] = { ...course };
    originalCoursePoints[semesterKey][course.subjtCd] = course.point;
  }

  // 2. 성적 데이터(CreditDTO)를 학기별로 병합
  for (const credit of creditDTOs) {
    const semesterKey = `${credit.cretGainYear}-${credit.cretSmrCd}`;
    if (!semesterMap[semesterKey]) {
      semesterMap[semesterKey] = { semester: semesterKey, courses: {} };
    }
    const existing = semesterMap[semesterKey].courses[credit.subjtCd];
    if (existing) {
      // 동일 과목이 이미 존재하면, 기존 수강 데이터에 성적 데이터를 병합한다.
      const hasOriginalCourse = Object.prototype.hasOwnProperty.call(originalCoursePoints[semesterKey] ?? {}, credit.subjtCd);
      const originalCoursePoint = originalCoursePoints[semesterKey]?.[credit.subjtCd];
      Object.assign(existing, credit);
      if (hasOriginalCourse && originalCoursePoint != null) {
        existing.point = originalCoursePoint;
      } else if (credit.gainPoint != null) {
        existing.point = credit.gainPoint;
      } else if (hasOriginalCourse) {
        existing.point = null;
      } else {
        delete existing.point;
      }
    } else {
      // 수강 데이터가 없는 경우, 성적 데이터만 추가한다.
      const merged: MergedSemesterCourseDTO = { ...credit };
      if (credit.gainPoint != null) {
        merged.point = credit.gainPoint;
      }
      semesterMap[semesterKey].courses[credit.subjtCd] = merged;
    }
  }

  // 3. 학기별 그룹 데이터를 MergedSemesterDTO 배열로 변환
  return Object.values(semesterMap).map(sem => ({
    semester: sem.semester,
    courses: Object.values(sem.courses),
  }));
}
