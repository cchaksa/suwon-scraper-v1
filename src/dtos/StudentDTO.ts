import { StudentStatus } from "../enums";

export interface StudentDTO {
    sno: string; // 학번 (예: 17019013)
    studNm: string; // 학생 이름 (예: 김민규)
    univCd: string; // 대학 코드 (예: 2000510)
    univNm: string; // 대학 이름 (예: ICT융합대학)
    dpmjCd: string; // 학과 코드 (예: 2000513)
    dpmjNm: string; // 학과 이름 (예: 정보통신학부)
    mjorCd: string; // 전공 코드 (예: 2000516)
    mjorNm: string; // 전공 이름 (예: 정보통신)
    the2MjorCd?: string; // 복수전공 코드 (선택적)
    the2MjorNm?: string; // 복수전공 이름 (선택적)
    enscYear: string; // 입학 연도 (예: 2017)
    enscSmrCd: string; // 입학 학기 코드 (예: 10)
    scrgStatNm: StudentStatus; // 재학 상태 (예: 재학, 졸업)
    studGrde: number; // 학년 (예: 3)
    enscDvcd: string; // 입학 구분 코드 (예: 1: 신입학, 2: 편입학)
    facSmrCnt: number; // 총 이수학기
    flangPassGb?: string; // 외국어 인증 (예: 통과/미통과)
  }
  