# 경건생활 앱(청소년부·학부모) — 데이터·API 계약 v1

> 이 문서가 프론트엔드·백엔드·테스트의 **단일 기준**이다. 임의 변경 금지 (CLAUDE.md 규칙).
> 선행 저장소 `kyuils/godly-life-check`의 계약(2026-07-18/19)을 계승하고, 본 앱의 신규 요구사항
> (달력·기도요청·참고자료·학생/학부모 구분)을 추가한다.

## 0. 선행 저장소에서 계승하는 결정 (재검토 없이 그대로 적용)

| 결정 | 내용 |
|---|---|
| 인증 | Google ID Token → `oauth2.googleapis.com/tokeninfo` 검증(aud/iss/exp/email_verified) + 토큰 다이제스트 5분 캐시 |
| 신뢰 경계 | 서버는 **토큰 email만** 신뢰. 클라이언트가 보낸 email·이름·role·구분은 전부 무시 |
| 시트 읽기 | 항상 **헤더 이름 기반**. 열 순서·삽입에 의존 금지 |
| 날짜 | 표준 "오늘" = Asia/Seoul `YYYY-MM-DD` 문자열 하나에서 모두 파생 |
| 쓰기 잠금 | 모든 쓰기 액션은 `LockService.getScriptLock().waitLock(15000)` |
| 전송 | `POST {GAS_URL}`, `Content-Type: text/plain;charset=utf-8` (CORS preflight 회피) |
| 수식 인젝션 | 자유 텍스트에 `sanitizeCell_` 적용 (`= + - @` 시작 시 `'` 접두) |
| active 규칙 | 빈 값은 active, `FALSE/NO/0/N`만 비활성 |
| 오류 노출 | 서버는 일반화된 `code`만 반환. 스택·시트ID·경로 노출 금지 |

## 1. 표준 날짜 규칙

- 표준 "오늘" = **Asia/Seoul 기준 `YYYY-MM-DD` 문자열**.
- 프론트: `new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())` — 브라우저 로컬 TZ 사용 금지.
- GAS: `Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd')`.
- 월 표기 `YM` = `YYYY-MM`. 연도 `YYYY`는 4자리 숫자 문자열.
- 시트에는 항상 문자열로 쓰되, 읽을 때 Date 객체로 돌아오는 셀도 `formatDate_`로 정규화한다.

## 2. 시트 스키마

스프레드시트 1개, 탭 5개(+ 연도별 RECORDS 추가). 시트 읽기는 항상 헤더 이름 기반.

### 2.1 MEMBERS_학생

헤더: `email | 이름 | 학년반 | active | 가입시각 | 가입경로`

### 2.2 MEMBERS_학부모

헤더: `email | 이름 | 자녀이름 | active | 가입시각 | 가입경로`

### 2.3 MEMBERS_교사

헤더: `email | 이름 | 역할 | active | 가입시각`

- `역할`: `teacher` | `admin` (v1에서 동일 취급). 빈 값이면 `teacher`로 간주.
- **이 시트는 `register` 액션이 절대 쓰지 않는다.** 사람이 시트를 직접 편집해야만 등재된다. (보안 불변식 3)

### 2.4 구분(kind)과 역할(role) 판정

`구분`은 **어느 명부 시트에 있는가**로 결정된다. 별도 컬럼으로 두지 않는다 — 시트가 곧 구분이므로
컬럼과 시트가 어긋나 권한이 잘못 계산되는 부류의 버그를 원천 차단한다.

| 등재된 시트 | kind | role |
|---|---|---|
| `MEMBERS_교사` | `teacher` | 시트의 `역할` 열 (`teacher`/`admin`) |
| `MEMBERS_학부모` | `parent` | `parent` |
| `MEMBERS_학생` | `student` | `student` |

- **조회 우선순위: 교사 → 학부모 → 학생.** 한 사람이 여러 시트에 활성 등재되어 있으면 우선순위가 높은 쪽을 채택한다
  (담임교사가 동시에 학부모인 실제 상황을 허용하기 위함).
- 어느 시트에도 없거나 전부 비활성이면 → `unauthorized`.
- 명부 조회 결과는 CacheService에 **60초** 캐시한다(키: `MEMBER_v1_<email소문자>`). `register` 성공 시 해당 키를 무효화한다.

### 2.5 RECORDS_YYYY (연도별. 예: `RECORDS_2026`)

헤더: `날짜 | email | 이름 | 구분 | 말씀읽음 | 와닿은말씀 | 결단 | 중보기도 | 기록시각 | 수정시각`

- 1행 = 사용자 1명의 하루. `(날짜, email)` 유니크 upsert.
- `구분`: `학생` | `학부모` | `교사` — 기록 시점의 kind를 **서버가** 채운다(사후 집계·필터용 비정규화 열).
- `말씀읽음`/`중보기도`: `TRUE`/`FALSE` 문자열. `와닿은말씀`/`결단`: 자유 텍스트(빈 값 허용).
- `email`·`이름`·`구분`은 검증된 토큰 email과 명부 조회 결과로만 서버가 채운다.
- **시트 자동 생성**: 대상 연도 시트가 없으면 헤더와 함께 생성한다(잠금 안에서).
- 텍스트 길이 상한: `와닿은말씀` 1000자, `결단` 1000자 (코드포인트 기준). 초과 시 `bad_request`.

### 2.6 PRAYERS

헤더: `기도ID | 등록일 | email | 이름 | 구분 | 기도제목 | 상태 | 응답일 | 응답메모 | 수정시각 | 삭제여부`

- `기도ID`: 서버 생성. `P` + `Utilities.getUuid()`의 하이픈 제거 앞 16자. 클라이언트 제공 값은 무시.
- `등록일`: `YYYY-MM-DD` (KST). **월별 그룹은 이 값의 앞 7자(`YYYY-MM`)로 만든다.**
- `상태`: `진행중` | `응답됨`
- `응답일`: 상태가 `응답됨`이 된 날짜(`YYYY-MM-DD`). `진행중`으로 되돌리면 빈 값으로 지운다.
- `응답메모`: 선택. 500자 상한.
- `기도제목`: 필수. 1~1000자.
- `삭제여부`: `TRUE`/빈 값. **소프트 삭제** — 실제 행은 지우지 않는다.

### 2.7 스키마 설계 근거 (변경 시 반드시 재검토할 것)

- **명부만 분리, 기록·기도는 단일 시트**: 사용자 결정(2026-07-30). 구분별 집계는 `구분` 열 필터로 처리.
- **기도 소프트 삭제 허용**: 요구사항 3에 삭제는 명시되지 않았으나, 기도제목은 본인의 민감한 개인 정보이고
  청소년 사용자가 오입력·오게시할 개연성이 높다. 본인이 회수할 수단이 없는 것은 설계 결함이므로 포함한다.
  행을 물리 삭제하지 않는 이유는 잠금 하 행 삭제가 다른 요청의 행 인덱스를 무효화하기 때문이다.
- **연도별 RECORDS 분할**: 100명 규모에서 연 36,500행. 단일 시트 전체 스캔의 지연을 연 단위로 묶어 제한한다.

## 3. 지표 정의

- **기록한 날** = 해당 날짜 행의 `말씀읽음 = TRUE`. (텍스트·중보기도만 있는 날은 미포함)
- **streak** = 표준 오늘부터 거슬러 올라가며 `말씀읽음=TRUE`가 연속인 일수.
  오늘 미기록이면 어제부터 센다(오늘은 아직 기회가 남았으므로 끊지 않는다).
- **주간 달성률** = 이번 주(월~일, KST) **경과 일수** 중 기록한 날 비율.
- **월간 달성률** = 이번 달 **경과 일수** 중 기록한 날 비율.
- **중보기도**는 별도 카운터: "최근 7일 중 n일" — streak·달성률에 미포함.
- streak가 연도 경계를 넘을 때: 프론트는 1월 1~7일 구간에서 전년도 기록도 함께 보유한 상태여야 한다(§4 `getMyRecords` 참조).

## 4. GAS API

요청: `POST {GAS_URL}`, body = `JSON.stringify({action, idToken, ...payload})`
응답: `{ok:true, ...}` / `{ok:false, code, message?}`

| 액션 | 파라미터 | 응답 | 권한 |
|---|---|---|---|
| `whoami` | — | `{ok, email, name, role, kind, extra}` | 명부 등재 + active |
| `register` | `name`, `kind`(`student`\|`parent`), `extra?`, `code` | `{ok, email, name, role, kind, extra}` | 로그인만 |
| `getMyRecords` | `years?: string[]` (기본 `[올해]`, 최대 2개) | `{ok, rows:[MyRecord]}` | 본인 |
| `setRecord` | `date, wordRead:bool, verse:str, resolution:str, intercession:bool` | `{ok:true}` | 본인 |
| `getMyPrayers` | — | `{ok, rows:[Prayer]}` — 삭제되지 않은 본인 전체 | 본인 |
| `addPrayer` | `text` | `{ok, id}` | 본인 |
| `updatePrayer` | `id, text` | `{ok:true}` | 본인 소유 행만 |
| `setPrayerAnswered` | `id, answered:bool, note?` | `{ok:true}` | **본인 소유 행만** |
| `deletePrayer` | `id` | `{ok:true}` | 본인 소유 행만 |
| `getAllRecords` | `days?` (기본 60, 최대 366) | `{ok, rows:[AllRecord]}` | teacher/admin |
| `getAllPrayers` | `days?` (기본 180, 최대 366) | `{ok, rows:[AllPrayer]}` | teacher/admin |
| `getMembers` | — | `{ok, members:[{email,name,kind,extra}]}` — 활성 학생·학부모 | teacher/admin |

### 4.1 응답 객체 형태

```
MyRecord   = {date, wordRead:bool, verse, resolution, intercession:bool, updatedAt}
AllRecord  = MyRecord + {email, name, kind}
Prayer     = {id, createdDate, text, status:'open'|'answered', answeredDate, note, updatedAt}
AllPrayer  = Prayer + {email, name, kind}
```

- `status`는 와이어에서 `open`/`answered`로 보내고, 시트에는 `진행중`/`응답됨`으로 쓴다(사람이 읽는 시트 우선).

### 4.2 액션별 세부 규칙

**`whoami`**
- 미등재(`unauthorized` 경로에만): `{ok:false, code:'unauthorized', email, canRegister:bool}`
- `canRegister` = 스크립트 속성 `REGISTER_CODE`가 trim 후 길이>0. 다른 에러 코드에는 부착하지 않는다.

**`register`**
- 검증 순서: 토큰 검증 → `kind` 검증 → 이름/extra 검증 → 백오프 검사 → 등록 폐쇄 검사 → 코드 대조 → 중복 검사 → append
- `kind`는 `student`|`parent`만 허용. **`teacher`는 어떤 경우에도 거부**(`bad_request`).
- 코드 비교 정규화: 양쪽 모두 trim + 소문자화 + 내부 공백 제거 후 비교. 불일치 → `bad_code`
- 백오프: email 키 CacheService 카운터 — 10분 창에서 `bad_code` 5회 초과 시 `too_many_attempts`
- 이름 검증: trim 후 빈 값 거부, 개행·제어문자 제거, 코드포인트 ≤30자. `extra`(학년반/자녀이름) ≤30자, 선택.
- 중복 검사: **세 명부 시트 전부**를 원시 스캔(active 무관, email 대소문자 무시)
  - 활성 행 존재 → `already_registered` / 비활성 행 존재 → `deactivated` / 없음 → append
  - **스캔→append 전체를 `LockService` 잠금 안에서** 수행
- 기록 값: `[토큰 email(소문자), 정제한 name, 정제한 extra, 'TRUE', nowIso, 'self']`
- 성공 응답은 `whoami` 성공과 동일 shape → 프론트가 그대로 진입 가능

**`getMyRecords`**
- `years`는 `/^\d{4}$/` 4자리만 허용, 최대 2개. 존재하지 않는 연도 시트는 빈 배열로 처리(에러 아님).
- 본인 행만 반환. 날짜 오름차순 정렬.
- 프론트는 1월 1~7일에 한해 `[올해, 작년]`을 요청한다(§3 streak 연도 경계).

**`setRecord`**
- `date`는 **표준 오늘 또는 어제만** 허용(미래·2일 이전 → `bad_request`).
- 대상 연도 = `date.slice(0,4)`. 해당 `RECORDS_YYYY` 시트가 없으면 생성.
- `기록시각`은 최초 생성 시각 보존, `수정시각`만 갱신.
- 성공 시 `getAllRecords` 캐시와 본인 캐시를 무효화.

**`getMyPrayers` / `addPrayer` / `updatePrayer` / `setPrayerAnswered` / `deletePrayer`**
- 소유권 검사: 대상 행의 `email`이 토큰 email과 일치해야 한다. 불일치 → `forbidden`.
  **존재하지 않는 id와 남의 id는 동일하게 `forbidden`을 반환한다**(존재 여부 유출 방지).
- 삭제된 행(`삭제여부=TRUE`)은 모든 읽기·쓰기에서 없는 것으로 취급 → `forbidden`.
- `setPrayerAnswered(answered:true)` → `상태='응답됨'`, `응답일`=표준 오늘. `false` → `상태='진행중'`, `응답일`=''.
- **교사는 응답 여부를 바꿀 수 없다**(사용자 결정 2026-07-30: 본인만).
- `updatePrayer`는 상태와 무관하게 본인이 수정 가능.

**`getAllRecords` / `getAllPrayers` / `getMembers`**
- `isTeacher_(auth)` 통과 필수. 아니면 `forbidden`.
- `getAllRecords`: 표준 오늘 기준 후행 `days`일. 연도 경계를 넘으면 두 연도 시트를 합쳐 읽는다.
- `getAllPrayers`: `등록일` 기준 후행 `days`일. 삭제 행 제외.

### 4.3 오류 코드

`unknown_action, server_error, no_token, server_misconfig, invalid_token, tokeninfo_failed,`
`aud_mismatch, iss_mismatch, token_expired, email_unverified, unauthorized, forbidden, bad_request,`
`registration_closed, bad_code, already_registered, deactivated, too_many_attempts`

### 4.4 캐시

| 대상 | TTL | 무효화 |
|---|---|---|
| 토큰 다이제스트 → email | 300초 | exp 재확인 |
| 명부 조회(`MEMBER_v1_<email>`) | 60초 | `register` 성공 |
| `getAllRecords` 원본(`ALLREC_v1_<year>`) | 300초 | `setRecord` |
| `getAllPrayers` 원본(`ALLPRAY_v1`) | 300초 | 기도 쓰기 액션 전부 |

본인 조회(`getMyRecords`/`getMyPrayers`)는 **서버 캐시하지 않는다**(쓰기 직후 자기 화면에 즉시 반영되어야 함).
프론트가 TTL 2분 캐시 + 쓰기 시 무효화(`WRITE_INVALIDATES`)로 처리한다.

## 5. 참고자료 (요구사항 4)

### 5.1 저장 방식

Google Sheets가 아니라 **저장소에 포함된 정적 JSON**(`web/data/*.json`)으로 둔다.
근거: 읽기 전용이고 사실상 불변이며, 오프라인 열람이 필요하고, GAS 왕복을 없애 체감 속도가 크게 다르다.

### 5.2 수집

`scripts/fetch-library.mjs` — 재실행 가능한 수집 스크립트.

- 출처 A(합동 5종): `https://gapck.org/api/v1/eMARKDOWN_USER_LIST?parent_table_cds[]=EL-총회헌법&parent_table_noes[]=<no>&skip=0&limit=250&sort=1`
  - `limit`은 250이 상한. 초과 시 API가 400을 반환하므로 페이지네이션(`skip`)으로 처리한다.
  - 카테고리 번호: 신도게요서 `3`, 소요리문답 `2`, 대요리문답 `8`, 예배모범 `4`, 신조 `6`
- 출처 B(하이델베르크): 공개 한글 번역본. 수집 시점에 확보한 출처 URL과 번역본 명칭을 `source`에 기록한다.
- `markdown_cont`는 HTML 조각이다. 태그를 제거하고 텍스트로 정규화하되 `<br>`은 개행으로 바꾼다.
- 문답형 문서는 제목이 `"12. 질문내용?"` 형식이다. 선행 번호를 파싱해 `no`로 분리하고 나머지를 `q`로 둔다.

### 5.3 JSON 스키마

```jsonc
{
  "id": "wsc",
  "title": "웨스트민스터 소요리문답",
  "shortTitle": "소요리문답",
  "type": "catechism",            // "catechism" | "chapters"
  "source": {
    "name": "대한예수교장로회(합동) 총회 전자자료실",
    "url": "https://gapck.org/library/general-assembly-constitution?...",
    "fetchedAt": "2026-07-30",
    "note": "교단 공개 자료"
  },
  "items": [                       // type=catechism
    { "no": 1, "q": "사람의 제일 되는 목적이 무엇인가?", "a": "...", "refs": ["고전 10:31", "롬 11:36"] }
  ],
  "sections": [                    // type=chapters
    { "no": 1, "title": "제1장 성경", "paras": ["...", "..."] }
  ]
}
```

- `web/data/index.json` — 문서 목록 메타(`id`, `title`, `shortTitle`, `type`, `count`, `file`, `bytes`).
  프론트는 index만 먼저 읽고, 본문은 사용자가 문서를 열 때 지연 로드한다.
- 파일: `wcf.json`(신도게요서), `wsc.json`(소요리), `wlc.json`(대요리), `worship.json`(예배모범),
  `creed.json`(신조), `heidelberg.json`(하이델베르크)

### 5.4 검증 (`scripts/test-library-data.mjs`)

- `index.json`에 열거된 모든 파일이 존재하고 스키마를 만족할 것
- 문답 수 하한: 소요리 ≥ 100, 대요리 ≥ 190, 하이델베르크 = 129
- 모든 문서에 비어 있지 않은 `source.name`·`source.url`·`source.fetchedAt`이 있을 것
- 본문에 HTML 태그 잔여물(`<p>`, `<br`, `&nbsp;`)이 없을 것
- 문답 번호가 1부터 연속일 것

## 6. 프론트엔드 모듈 계약

`web/index.html`은 구조와 부트스트랩만 담고, 로직은 ES module로 분리한다.

| 파일 | 책임 |
|---|---|
| `web/js/config.js` | `APP_CONFIG = { GAS_URL, OAUTH_CLIENT_ID, MOCK }` |
| `web/js/api.js` | 호출 헬퍼, TTL 2분 캐시, `WRITE_INVALIDATES`, `app:session-expired` 이벤트 |
| `web/js/auth.js` | Google Identity Services 로그인, 토큰 보관, 등록 화면 진입 판정 |
| `web/js/state.js` | 세션·현재 탭·로드된 데이터 보관 |
| `web/js/stats.js` | **순수 함수**(§3 지표). Node에서 테스트 가능하도록 부수효과 없음 |
| `web/js/mccheyne-plan.js` | `getReadings(dateStr)` → `{day, family:[..], secret:[..]}` (참고 저장소에서 복사) |
| `web/js/view-today.js` | 오늘 탭 |
| `web/js/view-calendar.js` | 달력 탭 |
| `web/js/view-prayer.js` | 기도 탭 |
| `web/js/view-library.js` | 자료 탭 |
| `web/js/view-class.js` | 우리반 탭 (교사만) |
| `web/css/app.css` | 디자인 토큰 + 컴포넌트 |

`MOCK`이 문자열이면 GIS 로그인을 건너뛰고 그 email의 모의 사용자로 진입한다(개발·E2E 전용).
**커밋 전 반드시 placeholder로 복원**하며, `scripts/check-web.mjs`가 이를 검사한다.

## 7. 화면

| 탭 | 내용 |
|---|---|
| 오늘 | 표준 오늘 날짜 + 맥체인 본문 4개(가정/개인) 카드, 말씀읽음 체크(pill), 와닿은말씀 textarea, 결단 textarea, 중보기도 체크(pill), 저장. "어제 기록" 전환 링크 |
| 달력 | 월 달력 그리드(월요일 시작). 각 날짜에 상태 점: 기록완료 / 미기록 / 미래. 상단에 streak·이번달 달성률·중보기도 카운터. 좌우 화살표로 월 이동(가입월 이전으로는 이동 불가). 날짜 탭 → 그날 기록 바텀시트(읽기 전용). 오늘·어제만 "수정하기" 버튼 노출 |
| 기도 | 상단 새 기도제목 입력. 아래 월별 섹션(최신 월 우선). **미응답 = 카드 펼침 상태로 상시 표시**, **응답됨 = `7/12 · 응답됨` 한 줄로 접힘 → 탭하면 펼침**. 각 카드에 응답 체크·수정·삭제 |
| 자료 | 문서 6종 목록 → 문서 열기 → 목차/문답 리스트. 상단 검색(문서 내 텍스트). 하단에 출처 표기 |
| 우리반 | (teacher/admin) 학생·학부모 구분 탭 → 최근 7일 ○/× 그리드 + streak/달성률, 구성원 탭 → 상세 바텀시트(email 병기). 기도제목 열람(읽기 전용, 응답 체크 불가) |

- 도메인 색: `--dev-read` green(말씀읽음), `--dev-verse` blue(와닿은말씀), `--dev-resolve` violet(결단), `--dev-prayer` orange(중보기도)
- PWA: `manifest.webmanifest` + 아이콘. 홈 화면 추가 가능.

## 8. 배포 순서

1. GAS: 코드 반영 후 **반드시 "배포 관리 → 기존 배포 수정 → 새 버전"** (새 배포 금지 — URL이 바뀌면 프론트가 구 백엔드를 호출)
2. 프론트 push (Pages 자동 재배포)

`doGet`은 `{ok:true, service, build}`를 반환하는 헬스체크로 두고, `BUILD_TAG`로 배포 반영 여부를 확인한다.

## 9. v1 범위 밖 (명시적 제외)

- 학부모–자녀 계정 연결 및 자녀 기록 열람 (사용자 결정 2026-07-30)
- 교사의 기도 응답 체크 (본인만 — 사용자 결정 2026-07-30)
- 푸시 알림, 이메일 발송
- 과거 날짜(2일 이전) 기록 수정
- 기록 히트맵
