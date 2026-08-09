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
- [x] `yarn build`와 `yarn test`를 실행한다.
- [x] 변경 파일과 영향 범위를 재검토한다.
