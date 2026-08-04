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
