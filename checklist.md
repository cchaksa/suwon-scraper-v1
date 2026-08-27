# Login Endpoint Checklist

- [x] 현재 HTTP 라우트와 로그인 흐름 확인
- [x] 기존 `/auth`와 `/scrape`의 로그인 중복 위치 확인
- [x] `POST /login` 라우트 테스트 추가
- [x] 로그인 실패 `401` 매핑 테스트 추가
- [x] 계정 잠금 `423` 매핑 테스트 추가
- [x] `/login`에서 스크래핑 함수 미호출 테스트 추가
- [x] 로그인 helper 분리
- [x] `/login`, `/auth`, `/scrape`를 공용 helper에 연결
- [x] 기존 worker/result/callback 흐름 비변경 확인
- [x] `AGENTS.md` 구조 변경 반영
- [x] README legacy API 표 갱신
- [x] `npm test` 실행
- [x] `git diff`로 변경 범위 재검토

# 이슈 21 구현 체크리스트

- [x] 편입생 포털에서 지정과목 화면과 API 경로를 확인한다.
- [x] 지정과목 결과 계약과 조건부 호출 방식을 설계한다.
- [x] 설계 및 컨텍스트 문서를 작성한다.
- [x] 테스트를 먼저 추가해 정상·빈 응답·응답 키 누락을 재현한다.
- [x] `DesignatedCourseDTO`와 지정과목 크롤러를 구현한다.
- [x] 편입생에게만 지정과목 API를 호출하도록 `scrapeJob`을 조정한다.
- [x] S3 결과 계약과 `AGENTS.md`를 동기화한다.
- [x] `yarn` 미설치 환경에서 임시 경로 TypeScript 컴파일과 전체 `node:test` 대체 검증을 실행한다.
- [x] 변경 파일과 영향 범위를 재검토한다.

## 편입인정학점 보정 체크리스트

- [x] 성적 단독 과목 회귀 테스트 추가
- [x] `gainPoint=0` 경계 테스트 추가
- [x] `gainPoint` 누락 경계 테스트 추가
- [x] 새 테스트의 RED 상태 확인
- [x] 성적 단독 병합 분기에 `point` 보정 추가
- [x] 대상 병합 테스트 통과 확인
- [x] `corepack yarn test` 전체 통과 확인
- [x] 생성된 `dist/*` 변경 원복
- [x] `git diff`와 영향 범위 재검토
- [x] 구현 및 검증 결과를 컨텍스트 문서에 기록

## 편입인정학점 보정 리뷰 보완 체크리스트

- [x] 성적 단독 중복 데이터 최신 `gainPoint` 회귀 테스트 추가
- [x] 명시적 `gainPoint=null` 경계 테스트 추가
- [x] 수강 데이터 non-null `point` 우선순위 회귀 테스트 추가
- [x] 새 중복 성적 테스트의 RED 상태 확인
- [x] 성적 단독 중복 시 최신 `gainPoint`로 `point` 갱신
- [x] 대상 병합 테스트 통과 확인
- [x] `corepack yarn test` 전체 통과 확인
- [x] 생성된 `dist/*` 변경 원복 및 변경 범위 재검토

## 중복 성적 학점 출처 보존 체크리스트

- [x] 원래 수강 `point=null`의 최신 `gainPoint` 회귀 테스트 추가
- [x] 성적 단독 최신 `gainPoint=null`·`undefined` 회귀 테스트 추가
- [x] 원래 수강 `point=null` 복원 회귀 테스트 추가
- [x] 새 테스트의 RED 상태 확인
- [x] 과목 키별 원래 수강 `point` 출처 보존 구현
- [x] 대상 병합 테스트 통과 확인
- [x] `corepack yarn test` 전체 통과 확인
- [x] 생성된 `dist/*` 변경 원복 및 변경 범위 재검토
- [x] Linux Docker 이미지 빌드 및 `/health` 응답 확인
- [x] 편입생 실계정에서 편입인정학점 `point == gainPoint` 확인
- [x] 일반 학생 실계정에서 스크래핑 및 학점 병합 회귀 확인

## 최신 성적 필드 누락 처리 체크리스트

- [x] 최신 중복 성적에서 `gainPoint` 키가 생략된 회귀 테스트 추가
- [x] 새 테스트가 이전 `gainPoint` 잔존으로 실패하는 RED 상태 확인
- [x] 최신 입력에 `gainPoint` 키가 없으면 기존 필드 제거
- [x] 대상 병합 테스트 통과 확인
- [x] `corepack yarn test` 전체 통과 확인
- [x] 생성된 `dist/*` 변경 원복 및 변경 범위 재검토
- [x] 구현 및 검증 결과를 컨텍스트 문서에 기록

## 이슈 24 학생 정보 및 S3 결과 계약 체크리스트

- [x] 이슈 범위와 현재 학생 정보 매핑 흐름 확인
- [x] `flangPassGb` 누락 시 `undefined` 유지 결정 기록
- [x] 학생 정보 크롤러 계약 테스트를 먼저 추가하고 RED 확인
- [x] `enscDvcd`와 `flangPassGb` 원본 매핑 검증
- [x] `flangPassGb` 누락 시 `undefined` 유지 검증
- [x] 최종 `ScrapeJobResult.student` 필드 보존 검증
- [x] README에 S3 원문 필드 의미와 누락 규칙 문서화
- [x] `AGENTS.md`와 구현·문서 일치 여부 확인
- [x] 대상 테스트와 전체 테스트 실행
- [x] 빌드 및 변경 범위 재검토
- [x] 검증 결과를 컨텍스트 문서에 기록
- [x] 편입생 실계정 스모크 테스트와 결과 기록
