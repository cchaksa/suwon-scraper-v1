# 편입생 지정과목 크롤링 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 편입생에게 지정된 선이수 과목을 조건부로 크롤링하고 모든 S3 성공 결과에 `designatedCourses` 배열을 포함한다.

**Architecture:** 기존 학생·수강·성적 요청의 병렬성을 유지하면서 학생 Promise가 `enscDvcd === "2"`로 완료된 경우에만 지정과목 요청을 시작한다. 지정과목 크롤러는 포털 응답의 `listPrecpSbjt`만 추출하며, 빈 배열·`null`·키 누락은 `[]`로 정규화한다. 인증된 페이지 단위 조합 함수를 분리해 실제 브라우저 없이 조건부 호출을 검증한다.

**Tech Stack:** Node.js, TypeScript, Playwright Core 1.41.2, `node:test`, AWS S3 결과 저장.

## Global Constraints

- 브랜치는 `feat/21`, 커밋 메시지는 `21 {타입}: {한글 메시지}` 형식을 사용한다.
- 새 TypeScript 파일 첫 줄에는 파일 역할을 설명하는 한 줄 한국어 주석을 넣는다.
- `dist/*`는 직접 수정하지 않고 `yarn build` 결과로만 생성한다.
- 현재 사용자 변경인 `.gitignore`는 수정하거나 stage하지 않는다.
- 편입학 판별은 기존 계약인 `enscDvcd === "2"`를 사용한다.
- 지정과목은 `semesters[].courses`에 병합하지 않고 최상위 `designatedCourses`로 반환한다.
- 지정과목 API 비정상 HTTP 상태는 전체 작업 실패로 전파한다.
- S3 키·checksum·콜백 메타데이터 계약은 변경하지 않는다.

---

### Task 1: 지정과목 DTO와 API 크롤러

**Files:**
- Create: `src/dtos/DesignatedCourseDTO.ts`
- Create: `src/crawlers/designatedCourseCrawler.ts`
- Create: `src/tests/designatedCourseCrawler.spec.ts`

**Interfaces:**
- Consumes: `Page`의 `page.request.post(url, { headers, data })` 인터페이스.
- Produces: `DesignatedCourseDTO`와 `scrapeDesignatedCourses(page: Page, username: string): Promise<DesignatedCourseDTO[]>`.

- [ ] **Step 1: 실패하는 크롤러 계약 테스트 작성**

`src/tests/designatedCourseCrawler.spec.ts`를 다음 내용으로 생성한다.

```ts
// 편입생 지정과목 API 요청과 응답 정규화를 검증하는 테스트
import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import type { DesignatedCourseDTO } from "../dtos/DesignatedCourseDTO";
import { scrapeDesignatedCourses } from "../crawlers/designatedCourseCrawler";

const designatedCourse: DesignatedCourseDTO = {
  orgClsCd: "ORG",
  subjtCd: "SUBJ001",
  subjtNm: "지정과목",
  point: 3,
  precpResnCd: "01",
  cretGainYear: "2026",
  cretSmrNm: "1학기",
  sno: "24020044",
};

function createPage(data: unknown, options: { ok?: boolean; status?: number } = {}) {
  const calls: Array<{ url: string; requestOptions: any }> = [];
  const page = {
    request: {
      post: async (url: string, requestOptions: any) => {
        calls.push({ url, requestOptions });
        return {
          ok: () => options.ok ?? true,
          status: () => options.status ?? 200,
          json: async () => data,
        };
      },
    },
  } as unknown as Page;

  return { page, calls };
}

test("지정과목 API에 학번을 전달하고 응답 배열을 반환한다", async () => {
  const { page, calls } = createPage({ listPrecpSbjt: [designatedCourse] });

  const result = await scrapeDesignatedCourses(page, "24020044");

  assert.deepEqual(result, [designatedCourse]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://info.suwon.ac.kr/precpSbjt/listPrecpSbjt.do");
  assert.deepEqual(calls[0].requestOptions.data, { sno: "24020044" });
  assert.equal(calls[0].requestOptions.headers["Content-Type"], "application/json;charset=UTF-8");
});

test("빈 배열, null, 응답 키 누락을 빈 배열로 정규화한다", async () => {
  for (const data of [{ listPrecpSbjt: [] }, { listPrecpSbjt: null }, {}]) {
    const { page } = createPage(data);
    assert.deepEqual(await scrapeDesignatedCourses(page, "24020044"), []);
  }
});

test("지정과목 API가 실패하면 상태 코드를 포함한 오류를 던진다", async () => {
  const { page } = createPage({}, { ok: false, status: 503 });

  await assert.rejects(() => scrapeDesignatedCourses(page, "24020044"), /Failed to fetch designated courses: 503/);
});
```

- [ ] **Step 2: 테스트가 아직 컴파일되지 않는지 확인**

Run: `yarn build`

Expected: FAIL with `TS2307` for the missing `DesignatedCourseDTO` or `designatedCourseCrawler` module.

- [ ] **Step 3: 최소 DTO와 크롤러 구현**

`src/dtos/DesignatedCourseDTO.ts`를 다음 내용으로 생성한다.

```ts
// 편입생에게 지정된 선이수 과목의 포털 응답 구조
export interface DesignatedCourseDTO {
  orgClsCd: string;
  subjtCd: string;
  subjtNm: string;
  point: number;
  precpResnCd: string;
  cretGainYear: string;
  cretSmrNm: string;
  sno: string;
}
```

`src/crawlers/designatedCourseCrawler.ts`를 다음 내용으로 생성한다.

```ts
// 편입생 지정과목 API를 호출해 선이수 과목 배열을 반환하는 크롤러
import type { Page } from "playwright-core";
import type { DesignatedCourseDTO } from "../dtos/DesignatedCourseDTO";
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
    throw new Error(`Failed to fetch designated courses: ${response.status()}`);
  }

  const data = await response.json();
  return Array.isArray(data?.listPrecpSbjt) ? data.listPrecpSbjt : [];
}
```

- [ ] **Step 4: 크롤러 테스트 실행**

Run: `yarn build && node --test dist/tests/designatedCourseCrawler.spec.js`

Expected: 3 tests PASS.

- [ ] **Step 5: DTO·크롤러 단위 커밋**

```bash
git add src/dtos/DesignatedCourseDTO.ts src/crawlers/designatedCourseCrawler.ts src/tests/designatedCourseCrawler.spec.ts
git commit -m "21 feat: 편입생 지정과목 크롤러 추가"
```

---

### Task 2: 편입생 조건부 조합과 결과 계약

**Files:**
- Create: `src/tests/scrapeJob.spec.ts`
- Modify: `src/services/scrapeJob.ts:1-54`
- Modify: `src/tests/worker.spec.ts:47-54`

**Interfaces:**
- Consumes: Task 1의 `scrapeDesignatedCourses(page, username)`와 기존 학생·수강·성적 크롤러.
- Produces: `scrapeAuthenticatedData(page: Page, username: string, deps?: ScrapeDataDeps): Promise<ScrapeJobResult>`와 `ScrapeJobResult.designatedCourses`.

- [ ] **Step 1: 조건부 호출과 병렬 시작을 검증하는 실패 테스트 작성**

`src/tests/scrapeJob.spec.ts`를 다음 내용으로 생성한다.

```ts
// 인증된 학사 페이지에서 편입생 지정과목을 조건부로 조합하는 테스트
import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import type { DesignatedCourseDTO } from "../dtos/DesignatedCourseDTO";
import type { StudentDTO } from "../dtos/StudentDTO";
import { scrapeAuthenticatedData, type ScrapeDataDeps } from "../services/scrapeJob";

const designatedCourse: DesignatedCourseDTO = {
  orgClsCd: "ORG",
  subjtCd: "SUBJ001",
  subjtNm: "지정과목",
  point: 3,
  precpResnCd: "01",
  cretGainYear: "2026",
  cretSmrNm: "1학기",
  sno: "24020044",
};

const gradeResponse = {
  listSmrCretSumTabYearSmr: [],
  selectSmrCretSumTabSjTotal: {
    gainPoint: "0",
    applPoint: "0",
    gainAvmk: "0",
    gainTavgPont: "0",
  },
};

function createDeps(enscDvcd: string) {
  let designatedCalls = 0;
  const deps: ScrapeDataDeps = {
    scrapeStudent: async () => ({ sno: "24020044", enscDvcd } as StudentDTO),
    scrapeCourses: async () => [],
    scrapeCredits: async () => ({ creditDTOs: [], gradeResponse }),
    scrapeDesignatedCourses: async () => {
      designatedCalls += 1;
      return [designatedCourse];
    },
  };

  return { deps, getDesignatedCalls: () => designatedCalls };
}

test("편입생이면 지정과목을 한 번 조회해 결과에 포함한다", async () => {
  const { deps, getDesignatedCalls } = createDeps("2");

  const result = await scrapeAuthenticatedData({} as Page, "24020044", deps);

  assert.equal(getDesignatedCalls(), 1);
  assert.deepEqual(result.designatedCourses, [designatedCourse]);
  assert.equal(result.student.enscDvcd, "2");
});

test("비편입생이면 지정과목 API를 호출하지 않고 빈 배열을 반환한다", async () => {
  const { deps, getDesignatedCalls } = createDeps("1");

  const result = await scrapeAuthenticatedData({} as Page, "24020044", deps);

  assert.equal(getDesignatedCalls(), 0);
  assert.deepEqual(result.designatedCourses, []);
});

test("수강과 성적 요청은 학생 정보 완료를 기다리지 않고 시작한다", async () => {
  const calls: string[] = [];
  let resolveStudent: (student: StudentDTO) => void = () => {};
  const pendingStudent = new Promise<StudentDTO>(resolve => {
    resolveStudent = resolve;
  });
  const deps: ScrapeDataDeps = {
    scrapeStudent: async () => {
      calls.push("student");
      return pendingStudent;
    },
    scrapeCourses: async () => {
      calls.push("courses");
      return [];
    },
    scrapeCredits: async () => {
      calls.push("credits");
      return { creditDTOs: [], gradeResponse };
    },
    scrapeDesignatedCourses: async () => {
      calls.push("designatedCourses");
      return [];
    },
  };

  const resultPromise = scrapeAuthenticatedData({} as Page, "24020044", deps);
  await Promise.resolve();
  assert.deepEqual(calls, ["student", "courses", "credits"]);

  resolveStudent({ sno: "24020044", enscDvcd: "2" } as StudentDTO);
  await resultPromise;

  assert.deepEqual(calls, ["student", "courses", "credits", "designatedCourses"]);
});
```

- [ ] **Step 2: 새 조합 함수가 없어 실패하는지 확인**

Run: `yarn build`

Expected: FAIL with `TS2305` because `scrapeAuthenticatedData` and `ScrapeDataDeps` are not exported yet.

- [ ] **Step 3: 조건부 조합 함수를 구현하고 scrapeJob에서 사용**

`src/services/scrapeJob.ts`를 다음 내용으로 교체한다.

```ts
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
```

`src/tests/worker.spec.ts`의 기본 `scrapeFn` 결과에서 `academicRecords` 다음에 필드를 추가해 변경된 반환 타입을 맞춘다.

```ts
      academicRecords: {
        listSmrCretSumTabYearSmr: [],
        selectSmrCretSumTabSjTotal: { gainPoint: "0", applPoint: "0", gainAvmk: "0", gainTavgPont: "0" },
      },
      designatedCourses: [],
```

- [ ] **Step 4: 조합 로직과 기존 회귀 테스트 실행**

Run: `yarn build && node --test dist/tests/scrapeJob.spec.js dist/tests/worker.spec.js`

Expected: 새 조합 테스트 3건과 기존 worker 테스트 모두 PASS.

- [ ] **Step 5: 조건부 조합 단위 커밋**

```bash
git add src/services/scrapeJob.ts src/tests/scrapeJob.spec.ts src/tests/worker.spec.ts
git commit -m "21 feat: 편입생 지정과목 결과 조합"
```

---

### Task 3: S3 원문 결과 계약 회귀 테스트

**Files:**
- Modify: `src/tests/worker.spec.ts:33-124`

**Interfaces:**
- Consumes: Task 2의 `ScrapeJobResult.designatedCourses`.
- Produces: 워커가 `scrapeJob` 결과를 S3 저장 payload에 그대로 전달한다는 회귀 테스트.

- [ ] **Step 1: 저장 payload 검증을 먼저 추가**

`정상 처리 시 succeeded 콜백 1회` 테스트의 의존성 구조 분해와 assertion을 다음처럼 변경한다.

```ts
  const { deps, callbackPayloads, getStoredDescriptors, getStoredPayloads } = createDeps();
```

```ts
  assert.deepEqual((getStoredPayloads()[0] as { designatedCourses: unknown[] }).designatedCourses, []);
```

- [ ] **Step 2: payload getter가 없어 실패하는지 확인**

Run: `yarn build`

Expected: FAIL with `TS2339` because `getStoredPayloads` does not exist on the `createDeps` return value.

- [ ] **Step 3: resultStorage mock에 저장 payload 기록 추가**

`createDeps`의 지역 상태에 다음 배열을 추가한다.

```ts
  const storedPayloads: unknown[] = [];
```

`resultStorage.put` 시작 부분에서 payload를 기록한다.

```ts
      put: async params => {
        storedPayloads.push(params.payload);
        const descriptor: StoredResultDescriptor = {
```

`createDeps` 반환값에 getter를 추가한다.

```ts
    getStoredDescriptors: () => storedDescriptors,
    getStoredPayloads: () => storedPayloads,
```

- [ ] **Step 4: 워커 계약 테스트 실행**

Run: `yarn build && node --test dist/tests/worker.spec.js`

Expected: worker 테스트 전체 PASS, 저장 payload의 `designatedCourses` assertion PASS.

- [ ] **Step 5: S3 계약 테스트 단위 커밋**

```bash
git add src/tests/worker.spec.ts
git commit -m "21 test: 지정과목 S3 결과 계약 검증"
```

---

### Task 4: 결과 계약 문서화와 전체 검증

**Files:**
- Modify: `README.md:3-49`
- Modify: `AGENTS.md:16-41`
- Modify: `docs/designated-courses-context.md`
- Modify: `checklist.md`

**Interfaces:**
- Consumes: 최종 `ScrapeJobResult`와 S3 저장 테스트 결과.
- Produces: 백엔드 소비자가 사용할 `designatedCourses` 필드 계약과 최신 저장소 구조 설명.

- [ ] **Step 1: README의 목적과 주요 기능 갱신**

README 첫 설명을 다음 문장으로 바꾼다.

```markdown
suwon-scraper는 수원대학교 포털 및 학사 시스템 데이터를 크롤링하여 학생의 기본정보, 수강 내역, 성적 정보, 편입생 지정과목을 수집하고 가공하는 Node.js 기반의 웹 크롤러입니다. AWS ECS에서 Docker를 이용해 컨테이너로 배포하여 실행할 수 있습니다.
```

주요 기능에 다음 항목을 추가한다.

```markdown
- 편입생 지정과목 조건부 크롤링
```

- [ ] **Step 2: README에 S3 원문 계약 추가**

`콜백 페이로드 구조` 다음에 아래 내용을 추가한다.

```markdown
### S3 스크래핑 원문 구조

- `student`: 학생 기본 정보. `enscDvcd`가 `"2"`이면 편입생이다.
- `semesters`: 학기별 수강·성적 병합 결과.
- `academicRecords`: 학기별·누적 성적 요약.
- `designatedCourses`: 편입생 지정과목 배열. 비편입생과 정상 빈 응답에서는 `[]`다.
- 지정과목 항목은 `orgClsCd`, `subjtCd`, `subjtNm`, `point`, `precpResnCd`, `cretGainYear`, `cretSmrNm`, `sno`를 포함한다.
```

- [ ] **Step 3: AGENTS 구조와 결과 계약 동기화**

프로젝트 목적을 다음처럼 바꾼다.

```markdown
- 목적: 수원대학교 포털/학사 시스템에서 학생 정보, 수강 정보, 성적 정보, 편입생 지정과목을 크롤링해 API로 제공
```

핵심 구조의 크롤러 설명을 다음처럼 바꾸고 DTO 항목 아래에 결과 계약을 추가한다.

```markdown
- `src/crawlers/*`: 학생/수강/성적/편입생 지정과목 크롤링 API 호출
- `src/tests/*`: 워커/콜백/에러 분류/크롤러 계약 테스트
- `src/dtos/*`: 외부 응답 및 내부 병합 구조 타입 정의
- S3 성공 원문은 `student`, `semesters`, `academicRecords`, `designatedCourses`를 포함하며 비편입생의 `designatedCourses`는 빈 배열이다.
```

- [ ] **Step 4: 전체 빌드와 테스트 실행**

Run: `yarn build`

Expected: TypeScript compile 성공, exit code 0.

Run: `yarn test`

Expected: 전체 테스트 PASS, exit code 0.

- [ ] **Step 5: 컨텍스트와 체크리스트 완료 상태 갱신**

검증이 성공하면 `docs/designated-courses-context.md` 끝에 다음 내용을 추가한다.

```markdown
## 구현 결과

- `DesignatedCourseDTO`와 `scrapeDesignatedCourses`를 추가했다.
- `scrapeAuthenticatedData`가 편입생에게만 지정과목 API를 호출한다.
- 모든 성공 결과와 S3 저장 payload가 `designatedCourses` 배열을 포함한다.
- README와 `AGENTS.md`를 최종 결과 계약에 맞게 동기화했다.

## 검증 결과

- `yarn build`: 성공.
- `yarn test`: 성공.
```

`checklist.md`의 이슈 21 섹션을 다음 완료 상태로 바꾼다.

```markdown
# 이슈 21 구현 체크리스트

- [x] 편입생 포털에서 지정과목 화면과 API 경로를 확인한다.
- [x] 지정과목 결과 계약과 조건부 호출 방식을 설계한다.
- [x] 설계 및 컨텍스트 문서를 작성한다.
- [x] 테스트를 먼저 추가해 정상·빈 응답·응답 키 누락을 재현한다.
- [x] `DesignatedCourseDTO`와 지정과목 크롤러를 구현한다.
- [x] 편입생에게만 지정과목 API를 호출하도록 `scrapeJob`을 조정한다.
- [x] S3 결과 계약과 `AGENTS.md`를 동기화한다.
- [x] `yarn build`와 `yarn test`를 실행한다.
- [x] 변경 파일과 영향 범위를 재검토한다.
```

- [ ] **Step 6: commit 전 double check 수행**

Run: `git diff --check`

Expected: 출력 없음, exit code 0.

Run: `git status -sb`

Expected: 의도한 문서 파일만 수정 상태이며 사용자 소유 `.gitignore` 변경은 unstaged 상태로 남아 있다.

Run: `git diff --stat`

Expected: `README.md`, `AGENTS.md`, 컨텍스트 문서, 체크리스트만 현재 미커밋 변경으로 표시된다.

- [ ] **Step 7: 문서 및 체크리스트 단위 커밋**

```bash
git add README.md AGENTS.md docs/designated-courses-context.md checklist.md
git commit -m "21 docs: 지정과목 결과 계약 문서화"
```

- [ ] **Step 8: 최종 커밋 상태 확인**

Run: `git log --oneline --decorate -5`

Expected: 이슈 21의 계획, 크롤러, 조합, S3 계약 테스트, 문서 커밋이 분리되어 보인다.

Run: `git status -sb`

Expected: `feat/21` 브랜치이며 사용자 소유 `.gitignore` 변경 외에 작업 파일 변경이 없다.

Run: `git diff main...HEAD --stat`

Expected: 이슈 21의 계획, DTO, 크롤러, 조합 로직, 테스트, 문서만 포함된다.
