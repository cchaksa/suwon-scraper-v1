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
