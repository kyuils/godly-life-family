# 경건생활 앱(청소년부·학부모) — 데이터·API 계약 v1.1

> 이 문서가 프론트엔드·백엔드·테스트의 **단일 기준**이다. 임의 변경 금지 (CLAUDE.md 규칙).
> 선행 저장소 `kyuils/godly-life-check`의 계약(2026-07-18/19)을 계승하고, 본 앱의 신규 요구사항
> (달력·기도요청·참고자료·학생/학부모 구분)을 추가한다.
>
> **v1.1 (2026-07-30) — 시니어 검토 반영.** 주요 변경: RECORDS 월별 분할(§2.5), 행 캐시 폐기(§4.4),
> 프론트 캐시 email 스코핑·계정 전환 파기(§6.1), read-verify-write와 `conflict`(§4.2), `busy`(§4.3),
> streak 데이터 기준 판정(§3), 배포 설정 명문화(§8), 참고자료 라이선스 필수(§5).
> 검토 원문: `docs/reviews/2026-07-30-senior-review-v1.md`

## 0. 선행 저장소에서 계승하는 결정 (재검토 없이 그대로 적용)

| 결정 | 내용 |
|---|---|
| 인증 | Google ID Token → `oauth2.googleapis.com/tokeninfo` 검증(aud/iss/exp/email_verified) + 토큰 다이제스트 5분 캐시 |
| 신뢰 경계 | 서버는 **토큰 email만** 신뢰 (§0.1) |
| 시트 I/O | **읽기·쓰기 모두 헤더 이름 기반.** 열 순서·위치에 의존 금지 (쓰기도 `rowFromObj_(headers, obj)`) |
| 날짜 | 표준 "오늘" = Asia/Seoul `YYYY-MM-DD` 문자열 하나에서 모두 파생 |
| 쓰기 잠금 | 모든 쓰기 액션은 `LockService.getScriptLock().waitLock(15000)` (§4.2 `busy` 규정 포함) |
| 전송 | `POST {GAS_URL}`, `Content-Type: text/plain;charset=utf-8` (CORS preflight 회피) |
| 수식 인젝션 | 자유 텍스트에 `sanitizeCell_` 적용 (`= + - @` 시작 시 `'` 접두) |
| active 규칙 | 빈 값은 active, `FALSE/NO/0/N`만 비활성 |
| 오류 노출 | 서버는 일반화된 `code`만 반환. 스택·시트ID·경로 노출 금지 |

### 0.1 신뢰 경계 (정확한 문언)

**권한에 영향을 주는 값(role, 교사 여부, active)은 어떤 경우에도 클라이언트 입력을 반영하지 않는다.**
`register`의 `kind`는 `student`|`parent`만 허용되는 **자기신고 값**이며 어떤 권한도 부여하지 않는다.
그 외 모든 액션에서 클라이언트가 보낸 `email`·`name`·`kind`·`role`은 **무시**한다.

## 1. 표준 날짜 규칙

- 표준 "오늘" = **Asia/Seoul 기준 `YYYY-MM-DD` 문자열**.
- 프론트: `new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())` — 브라우저 로컬 TZ 사용 금지.
- GAS: `Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd')`.
- 월 표기 `YM` = `YYYY-MM` (`/^\d{4}-\d{2}$/`).
- 시트에는 항상 문자열로 쓰되, 읽을 때 Date 객체로 돌아오는 셀도 `formatDate_`로 정규화한다.

## 2. 시트 스키마

스프레드시트 1개. 명부 3탭 + `PRAYERS` 1탭 + 월별 `RECORDS_YYYY-MM` 탭(자동 생성).

### 2.0 사람이 편집해도 되는 시트 (불변식)

> **사람이 직접 편집해도 되는 시트는 `MEMBERS_학생`·`MEMBERS_학부모`·`MEMBERS_교사` 3개뿐이다.**
> **`RECORDS_*`와 `PRAYERS`는 읽기 전용으로 취급한다 — 정렬·행 삽입·행 삭제·열 이동·열 삽입 금지.**
> 조회는 반드시 **필터 보기(Filter view)** 로만 한다(일반 필터·정렬은 실제 행 순서를 바꾼다).

근거: 쓰기 경로는 스냅샷 시점의 행 번호(`_rowIndex`)로 갱신한다. `LockService`는 **같은 스크립트의 동시 실행만**
직렬화하며 **사람이 스프레드시트 UI에서 하는 편집은 막지 못한다.** 사람이 정렬하는 순간 학생이 저장하면
다른 사람의 행을 덮어쓴다(복구 불가한 데이터 파괴 + 개인정보 교차 기록).
§4.2의 read-verify-write가 2차 방어지만, 1차 방어는 이 규칙이다.
`docs/ops/`의 최초 설치 절차에서 `RECORDS_*`·`PRAYERS`에 **시트 보호(소유자만 편집)** 를 건다.

### 2.1 MEMBERS_학생

헤더: `email | 이름 | 학년반 | active | 가입시각 | 가입경로`

### 2.2 MEMBERS_학부모

헤더: `email | 이름 | 자녀이름 | active | 가입시각 | 가입경로`

### 2.3 MEMBERS_교사

헤더: `email | 이름 | 역할 | active | 가입시각`

- `역할`: `teacher` | `admin` (v1에서 동일 취급). 빈 값이면 `teacher`로 간주.
- **`register` 액션은 이 시트에 절대 쓰지 않는다.** 사람이 시트를 직접 편집해야만 등재된다.

### 2.4 구분(kind)과 역할(role) 판정

`구분`은 **어느 명부 시트에 있는가**로 결정된다. 별도 컬럼으로 두지 않는다 — 시트가 곧 구분이므로
컬럼과 시트가 어긋나 권한이 잘못 계산되는 부류의 버그를 원천 차단한다.

| 등재된 시트 | kind | role |
|---|---|---|
| `MEMBERS_교사` | `teacher` | 시트의 `역할` 열 (`teacher`/`admin`) |
| `MEMBERS_학부모` | `parent` | `parent` |
| `MEMBERS_학생` | `student` | `student` |

**판정 절차 (순서 고정)**
1. 세 시트 각각에서 email이 일치하고 **`active`인 행만** 후보로 수집한다.
2. 후보가 0개면 → `unauthorized`. (비활성 행만 있는 경우도 여기에 해당한다)
3. 후보 중 우선순위 **교사 › 학부모 › 학생** 최상위를 채택한다.

- **비활성 행은 우선순위 계산에서 완전히 제외한다.** "교사 시트에 행이 있으면 즉시 teacher" 식으로 구현하면
  해임된(비활성) 교사가 권한을 유지하거나, 반대로 학생 시트에 정상 등재된 사람이 잠긴다. 둘 다 금지다.
- 우선순위가 존재하는 이유는 "담임교사가 동시에 학부모인" 상태를 허용하기 위함이다. 이 상태는
  `register`의 3시트 중복 검사가 차단하므로 **수기 편집으로만 도달할 수 있다.**
- 명부 조회 결과는 CacheService에 **60초** 캐시한다(§4.4).

### 2.5 RECORDS_YYYY-MM (월별. 예: `RECORDS_2026-07`)

헤더: `날짜 | email | 이름 | 구분 | 말씀읽음 | 와닿은말씀 | 결단 | 중보기도 | 기록시각 | 수정시각`

- 1행 = 사용자 1명의 하루. `(날짜, email)` 유니크 upsert. 대상 시트 = `RECORDS_` + `date.slice(0,7)`.
- `구분`: `학생` | `학부모` | `교사` — 기록 시점의 kind를 **서버가** 채운다(집계·필터용 비정규화 열).
- `말씀읽음`/`중보기도`: `TRUE`/`FALSE` 문자열. `와닿은말씀`/`결단`: 자유 텍스트(빈 값 허용).
- `email`·`이름`·`구분`은 검증된 토큰 email과 명부 조회 결과로만 서버가 채운다.
- **시트 자동 생성은 쓰기 액션에서만, 잠금 안에서** 일어난다. 읽기 액션은 절대 시트를 만들지 않는다
  (락 없이 생성하면 헤더 없는 시트가 생길 수 있다). 읽기에서 없는 시트는 §4.2 공통 규정대로 빈 배열이다.
- 텍스트 길이 상한: `와닿은말씀` 1000자, `결단` 1000자 (코드포인트). 초과 시 `bad_request`.

### 2.6 PRAYERS

헤더: `기도ID | 등록일 | email | 이름 | 구분 | 기도제목 | 상태 | 응답일 | 수정시각 | 삭제여부`

- `기도ID`: 서버 생성. `P` + `Utilities.getUuid()`의 하이픈 제거 앞 16자. 클라이언트 제공 값은 무시.
- `등록일`: `YYYY-MM-DD` (KST). **월별 그룹은 이 값의 앞 7자(`YYYY-MM`)로 만든다.**
- `상태`: `진행중` | `응답됨`. **`응답됨` 외의 모든 값은 와이어에서 `open`으로 간주한다**
  (사람이 시트에서 "완료" 등으로 고쳐도 앱이 깨지지 않도록).
- `응답일`: 상태가 `응답됨`이 된 날짜. `진행중`으로 되돌리면 빈 값으로 지운다.
- `기도제목`: 필수. 1~1000자.
- `삭제여부`: `TRUE`/빈 값. **소프트 삭제** — 실제 행은 지우지 않는다.
- 등록 상한: 1인 1일 **20건**, 활성(미삭제) 기도 **100건**. 초과 시 `bad_request`.
- 월별 분할하지 않는다(기도 발생량이 기록의 1/30 수준). 삭제 행 누적은 `docs/ops/` 연간 점검으로 처리.

### 2.7 스키마 설계 근거 (변경 시 반드시 재검토할 것)

- **명부만 분리, 기록·기도는 단일 계열**: 사용자 결정(2026-07-30). 구분별 집계는 `구분` 열 필터로 처리.
- **RECORDS 월별 분할 (v1.1에서 연도별→월별로 변경)**: 최악 행 수를 **`인원 × 31`로 고정**한다
  (100명 = 3,100행). 연도별 분할은 1년차 12월에 36,500행이 되어 단일 시트와 동일했고,
  이 앱의 주 접근 단위(월 달력)와도 축이 어긋났다. 월별은 달력 탭·오늘 탭·저장 upsert 스캔이
  전부 한 시트에 들어맞아 락 보유 시간도 함께 줄어든다.
  연속기록은 §3의 월 역주행으로 처리한다(공백을 만나면 조기 중단하므로 보통 1~2개 시트만 읽는다).
- **기도 소프트 삭제 허용**: 요구사항 3에 삭제는 명시되지 않았으나, 기도제목은 본인의 민감한 개인 정보이고
  청소년 사용자가 오입력·오게시할 개연성이 높다. 본인이 회수할 수단이 없는 것은 설계 결함이므로 포함한다.
  물리 삭제 대신 소프트 삭제를 쓰는 이유는 **교사가 실수 삭제를 복구할 수 있어야 하고, 감사 흔적이 남아야 하기 때문**이다.

## 3. 지표 정의

- **기록한 날** = 해당 날짜 행의 `말씀읽음 = TRUE`. (텍스트·중보기도만 있는 날은 미포함)
- **streak** = 표준 오늘부터 거슬러 올라가며 `말씀읽음=TRUE`가 연속인 일수.
  오늘 미기록이면 어제부터 센다(오늘은 아직 기회가 남았으므로 끊지 않는다).
- **주간 달성률** = 이번 주(월~일, KST) **경과 일수** 중 기록한 날 비율.
- **월간 달성률** = 이번 달 **경과 일수** 중 기록한 날 비율.
- **중보기도**는 별도 카운터: "최근 7일 중 n일" — streak·달성률에 미포함.

### 3.1 월 경계 처리 (데이터 기준 — 날짜 기준 금지)

프론트는 **기본으로 `[이번달, 지난달]` 2개월을 요청**한다(주간 달성률이 월을 걸치는 경우까지 커버).

> **연속기록이 로드된 가장 이른 달의 1일까지 끊기지 않고 이어진 경우에 한해**, 그 이전 달을 1개 더 요청해
> 재계산한다. 이를 최대 **6개월(180일)** 까지 반복한다. 6개월을 가득 채우면 화면에 **`180일+`** 로 표시한다.
> (v1의 명시적 한계 — 무제한 역주행은 하지 않는다.)

"1월 1~7일에는 작년도 로드" 같은 **날짜 기준 규칙을 쓰지 않는다.** streak 길이에 상한이 없으므로
날짜로 판정하면 200일 연속인 사용자가 1월 8일에 `8일`로 표시되는 결함이 생긴다.

## 4. GAS API

요청: `POST {GAS_URL}`, body = `JSON.stringify({action, idToken, ...payload})`
응답: `{ok:true, ...}` / `{ok:false, code, message?}`

| 액션 | 파라미터 | 응답 | 권한 |
|---|---|---|---|
| `whoami` | — | `{ok, email, name, role, kind, extra, joinedAt}` | 명부 등재 + active |
| `register` | `name`, `kind`(`student`\|`parent`), `extra?`, `code` | `whoami`와 동일 shape | 로그인만 |
| `getMyRecords` | `months: string[]` (`YYYY-MM`, 1~6개) | `{ok, rows:[MyRecord]}` | 본인 |
| `setRecord` | `date, wordRead:bool, verse:str, resolution:str, intercession:bool` | `{ok:true}` | 본인 |
| `getMyPrayers` | — | `{ok, rows:[Prayer]}` — 미삭제 본인 전체 | 본인 |
| `addPrayer` | `text` | `{ok, id}` | 본인 |
| `setPrayerAnswered` | `id, answered:bool` | `{ok:true}` | **본인 소유 행만** |
| `deletePrayer` | `id` | `{ok:true}` | 본인 소유 행만 |
| `getAllRecords` | `days?` (기본 60, 최대 180) | `{ok, rows:[AllRecord], windowDays}` | teacher/admin |
| `getAllPrayers` | `days?` (기본 180, 최대 366) | `{ok, rows:[AllPrayer]}` | teacher/admin |
| `getMembers` | — | `{ok, members:[{email,name,kind,extra,joinedAt}]}` — 활성 학생·학부모 | teacher/admin |

### 4.1 응답 객체 형태

```
MyRecord   = {date, wordRead:bool, verse, resolution, intercession:bool, updatedAt}
AllRecord  = MyRecord + {email, name, kind}
Prayer     = {id, createdDate, text, status:'open'|'answered', answeredDate, updatedAt}
AllPrayer  = Prayer + {email, name, kind}
```

- `status`는 와이어에서 `open`/`answered`, 시트에는 `진행중`/`응답됨`으로 쓴다(사람이 읽는 시트 우선).
- `joinedAt`은 `YYYY-MM-DD`. 파싱 불가하거나 빈 값이면 `''`를 반환하고, 프론트는 이 경우 달력 하한을
  "가장 오래된 기록의 달"로 대체한다.

### 4.2 액션별 세부 규칙

**공통 — 읽기**

> **모든 읽기 액션에서 존재하지 않는 `RECORDS_YYYY-MM` 시트는 빈 배열로 취급하며 오류가 아니다.**
> 읽기 액션은 시트를 생성하지 않는다.

**공통 — 쓰기 (read-verify-write)**

> `updateRowByIndex_`로 갱신하기 **직전에 대상 행의 키 열을 다시 읽어 일치를 확인한다**
> (`RECORDS_*`는 `날짜`+`email`, `PRAYERS`는 `기도ID`). 불일치하면 쓰기를 중단하고 `conflict`를 반환한다.
> 사람이 시트를 정렬·편집해 행 번호가 어긋났을 때 **남의 행을 덮어쓰는 것을 막는 최후 방어선**이다.
> 프론트는 `conflict`에 "잠시 후 다시 시도해 주세요" 안내를 띄우고 자동 재시도하지 않는다.

**공통 — 잠금**

> `waitLock(15000)`은 실패 시 **예외를 던진다.** 반드시 `try`로 감싸 `{ok:false, code:'busy'}`를 반환한다
> (`server_error`로 새어 나가면 안 된다). 프론트는 `busy`에 한해 지수 백오프(1초, 3초)로 **최대 2회**
> 자동 재시도하고, 그래도 실패하면 안내를 띄운다. 저장 버튼은 전송 중 `disabled`로 둔다(더블 서브밋 방지).

**`whoami`**
- 미등재(`unauthorized` 경로에만): `{ok:false, code:'unauthorized', email, canRegister:bool}`
- `canRegister` = 스크립트 속성 `REGISTER_CODE`가 trim 후 길이>0. 다른 에러 코드에는 부착하지 않는다.

**`register`**
- 검증 순서: 토큰 검증 → `kind` 검증 → 이름/extra 검증 → 백오프 검사 → 등록 폐쇄 검사 → 코드 대조 → 중복 검사 → append
- `kind`는 `student`|`parent`만 허용. **`teacher`는 어떤 경우에도 거부**(`bad_request`).
- 코드 비교 정규화: 양쪽 모두 trim + 소문자화 + 내부 공백 제거 후 비교. 불일치 → `bad_code`
- 백오프 **2단**:
  - email 단위: 10분 창에서 `bad_code` 5회 초과 → `too_many_attempts`
  - **전역 단위(`REG_FAIL_GLOBAL`): 10분 창에서 20회 초과 → 모든 요청 `too_many_attempts`.**
    email 단위만 두면 계정을 바꿔가며 무제한 시도할 수 있다(전역 상한 부재).
- 이름 검증: trim 후 빈 값 거부, 개행·제어문자 제거, 코드포인트 ≤30자. `extra` ≤30자, 선택.
- 중복 검사: **세 명부 시트 전부**를 원시 스캔(active 무관, email 대소문자 무시)
  - 활성 행 존재 → `already_registered` / 비활성 행 존재 → `deactivated` / 없음 → append
  - **스캔→append 전체를 `LockService` 잠금 안에서** 수행
- 기록 값은 **`rowFromObj_(headers, obj)`로 헤더 순서에서 생성한다**(위치 기반 배열 금지 — §0).
  값: email=토큰 email(소문자), 이름=정제한 name, extra, active=`TRUE`, 가입시각=오늘(`YYYY-MM-DD`), 가입경로=`self`
- 성공 응답은 `whoami` 성공과 동일 shape → 프론트가 그대로 진입 가능

**`getMyRecords`**
- `months`는 `/^\d{4}-\d{2}$/` 형식만 허용, **1~6개**. 범위 밖 → `bad_request`.
- 본인 행만 반환. 날짜 오름차순 정렬.

**`setRecord`**
- `date`는 **표준 오늘 또는 어제만** 허용(미래·2일 이전 → `bad_request`).
- 대상 시트 = `RECORDS_` + `date.slice(0,7)`. 없으면 **잠금 안에서** 헤더와 함께 생성.
- upsert 스캔은 **키 열(`날짜`,`email`)만 읽어** 행을 찾고 그 행만 쓴다(락 보유 시간 최소화).
- `기록시각`은 최초 생성 시각 보존, `수정시각`만 갱신.
- 서버 캐시 무효화 대상 **없음**(§4.4 — 행 캐시를 두지 않는다). 프론트 `WRITE_INVALIDATES`가 처리한다.

**기도 액션 (`getMyPrayers`/`addPrayer`/`setPrayerAnswered`/`deletePrayer`)**
- 소유권 검사: 대상 행의 `email`이 토큰 email과 일치해야 한다.
  **존재하지 않는 id, 남의 id, 삭제된 id는 전부 동일하게 `forbidden`을 반환한다**(존재 여부 유출 방지).
- `setPrayerAnswered(true)` → `상태='응답됨'`, `응답일`=표준 오늘. `(false)` → `상태='진행중'`, `응답일`=`''`.
- **교사는 응답 여부를 바꿀 수 없다**(사용자 결정 2026-07-30: 본인만). 교사에게는 읽기만 노출한다.

**`getAllRecords` / `getAllPrayers` / `getMembers`**
- `isTeacher_(auth)` 통과 필수. 아니면 `forbidden`.
- `getAllRecords`: 표준 오늘 기준 후행 `days`일이 걸치는 **월 시트들만** 읽어 합친다(최대 7개월).
  응답에 `windowDays`를 함께 반환한다 — 프론트는 창을 가득 채운 streak를 **`{windowDays}+`** 로 표기한다
  (본인 화면의 streak과 값이 다를 수 있음을 화면에서 드러내기 위함).
- `getAllPrayers`: `등록일` 기준 후행 `days`일. 삭제 행 제외.

### 4.3 오류 코드

`unknown_action, server_error, no_token, server_misconfig, invalid_token, tokeninfo_failed,`
`aud_mismatch, iss_mismatch, token_expired, email_unverified, unauthorized, forbidden, bad_request,`
`busy, conflict,`
`registration_closed, bad_code, already_registered, deactivated, too_many_attempts`

### 4.4 캐시 (v1.1에서 행 캐시 전면 폐기)

| 대상 | TTL | 비고 |
|---|---|---|
| 토큰 다이제스트 → email | 300초 | 히트 시 `exp` 재확인 |
| 명부 조회 `MEMBER_v1_<email소문자>` | 60초 | **미등재 결과도 `{found:false}`로 동일 TTL 캐시**한다 |
| 등록 실패 카운터 (email별 / 전역) | 600초 | §4.2 |

- **`getAllRecords`·`getAllPrayers`·`getMyRecords`·`getMyPrayers`의 행 캐시는 두지 않는다.**
  근거: `CacheService`의 **키당 저장 한도는 100KB** [확정 — Apps Script `Cache` 공식 문서].
  `AllRecord` 1행은 텍스트가 비어 있어도 JSON으로 약 190바이트이므로 **약 500행(100명×5일)** 이 상한이다.
  운영 1주일이면 한도를 넘고, 선행 구현의 `safeCachePut_`은 초과 시 **조용히 건너뛴다** — 계약이 약속한
  캐시가 존재하지 않는데 아무도 모르는 상태가 된다. 지킬 수 없는 약속은 계약에서 뺀다.
- 명부 캐시 주의:
  - 교사가 시트에서 `active`를 `FALSE`로 바꿔 차단해도 **최대 60초 지연**된다. `docs/ops/`에 명시한다.
  - **캐시 읽기·쓰기 실패는 인증을 차단하지 않는다.** 실패 시 원본 조회로 폴백한다.
- 본인 조회의 응답성은 **프론트 캐시**(§6.1)가 담당한다.

### 4.5 성능 목표 (검증 가능한 형태로)

- 목표: 100명·월말 기준 `setRecord` 성공률 99%, `getMyRecords`(2개월) 5초 이내.
- `scripts/test-gas-actions.mjs`는 **3,100행 모의 시트에서 각 액션이 읽는 셀 수를 세는 테스트**를 포함한다.
  시간이 아니라 **읽는 셀 수**를 세는 것이 결정적이고 재현 가능하다.
  회귀 기준: `setRecord`의 스캔은 키 열 2개만 읽어야 한다(전체 열 읽기 금지).

## 5. 참고자료 (요구사항 4)

### 5.1 저장 방식

Google Sheets가 아니라 **저장소에 포함된 정적 JSON**(`web/data/*.json`)으로 둔다.
근거: 읽기 전용이고 사실상 불변이며, 오프라인 열람이 필요하고, GAS 왕복을 없애 체감 속도가 다르다.
자료 탭의 문서 내 검색은 이 정적 JSON에 대한 클라이언트 측 문자열 검색이므로 서버 비용이 없다.

### 5.2 수집

`scripts/fetch-library.mjs` — 재실행 가능한(멱등) 수집 스크립트. Node 18+ 내장 `fetch`만 사용.

- 출처 A(합동 5종): `https://gapck.org/api/v1/eMARKDOWN_USER_LIST?parent_table_cds[]=EL-총회헌법&parent_table_noes[]=<no>&skip=0&limit=250&sort=1`
  - 카테고리 번호: 신도게요서 `3`, 소요리문답 `2`, 대요리문답 `8`, 예배모범 `4`, 신조 `6`
  - `limit` 상한은 **250** [확정 — 2026-07-30 직접 호출, 251 요청 시 `400 PARAM_ERROR : paramInt(limit) > max value : 250`].
    총량은 응답의 `count` 필드로 확인하고 `skip`으로 전량 수집한다.
  - **`del_yn`이 `Y`인 항목은 제외한다.**
- 출처 B(하이델베르크): 공개 한글 번역본. **이용 조건이 명확히 자유로운 판본만** 채택한다(§5.5).
- `markdown_cont`는 HTML 조각이다. 태그를 제거하고 `<br>`은 개행으로, HTML 엔티티는 디코드한다.
- 문답형 제목은 `"12. 질문내용?"` 형식이다. 선행 번호를 `no`로 파싱하고 나머지를 `q`로 둔다.

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
    "license": "확인한 이용 조건을 그대로 기재",
    "licenseConfidence": "확정" | "추정" | "제한적",
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

- `web/data/index.json` — 목록 메타(`id, title, shortTitle, type, count, file, bytes`).
  프론트는 index만 먼저 읽고, 본문은 문서를 열 때 **지연 로드**한다.
- 파일: `wcf.json`(신도게요서), `wsc.json`(소요리), `wlc.json`(대요리), `worship.json`(예배모범),
  `creed.json`(신조), `heidelberg.json`(하이델베르크)

### 5.4 검증 (`scripts/test-library-data.mjs`)

- `index.json`에 열거된 모든 파일이 존재하고 스키마를 만족할 것
- **문답·장 수 정확 일치**: 소요리 = **107**, 대요리 = **196**, 하이델베르크 = **129**, 신도게요서 = **33장**
  (하한 `≥`가 아니라 정확 일치. 하한은 수집 누락을 잡아내지 못해 테스트의 목적을 달성하지 못한다)
- 문답 번호가 1부터 빠짐없이 연속일 것
- 모든 문서에 비어 있지 않은 `source.name`·`source.url`·`source.fetchedAt`·**`source.license`** 가 있을 것
- 본문에 HTML 태그 잔여물(`<p>`, `<br`, `&nbsp;`)이 없을 것
- 해당 파일이 존재하지 않으면 그 문서 검증은 건너뛰되, `index.json`과 불일치하면 실패로 처리한다

### 5.5 재배포 이용 조건 (요구사항 4의 전제)

이 저장소는 GitHub Pages로 **공개 배포**되므로 수집 본문의 재배포에 해당한다.

- 모든 문서에 `source.license`를 **실제로 확인한 내용만** 기재한다. 확인하지 못하면 그 사실을 그대로 적고
  `licenseConfidence: "제한적"`으로 표시한다. 임의로 "퍼블릭 도메인"이라 단정하지 않는다.

### 5.5.1 조사 결과 및 사용자 결정 (2026-07-30)

**조사 결과 — 6종 모두 재사용 허락 문구를 찾지 못했다.**

| 문서 | 확인한 표기 | licenseConfidence |
|---|---|---|
| 합동 5종 | `Copyright ⓒ 대한예수교장로회총회. All Rights Reserved.` (gapck.org footer 직접 확인) | `확정` (표기 존재 자체가 확정) |
| 하이델베르크 | `저작권 2010` (주일 페이지) / `© 2026 모든 저작권은 보호되어 있습니다.` (사이트 footer) | `제한적` |

하이델베르크는 원문(1563)의 저작권이 소멸했으나 **한글 번역은 번역 저작권 대상일 수 있다.**
확인한 후보 4곳(heidelberg-catechism.com/ko, CRCNA 공식 한글 PDF, 한국어 위키문헌, koreancrc.com)
중 자유 이용을 명시한 곳은 없었다.

**사용자 결정**: 위 조사 결과를 그대로 보고한 뒤, 사용자는 **6종 모두 본문 포함 + 출처·저작권 명시**로
진행하기로 결정했다. 근거는 교단 소속 교회의 비영리 교육 목적이며 원문을 그대로 인용한다는 점이다.

**따라서 다음을 지킨다.**
1. 자료 화면 하단에 `source.name` / `source.license` / `fetchedAt`을 **항상 노출한다**(계약 §7).
2. `licenseConfidence`가 `제한적`인 문서는 화면에 그 사실을 함께 표시한다.
3. 참고자료는 `web/data/`에 **완전히 분리**해 둔다 — 총회·번역처의 요청이 있으면
   해당 JSON 파일을 지우고 `index.json`에서 항목을 빼는 것만으로 즉시 제거된다.
   `scripts/fetch-library.mjs`의 `HC_INCLUDE` 플래그도 같은 목적이다.
4. 이 결정은 **법률 자문이 아니다.** 총회 측 요청이 있으면 즉시 (3)의 절차로 제거한다.

## 6. 프론트엔드 모듈 계약

`web/index.html`은 구조와 부트스트랩만 담고, 로직은 ES module로 분리한다.
(`web/js/mccheyne-plan.js`는 UMD이므로 예외적으로 일반 `<script>`로 먼저 로드해 `window.MccheynePlan`을 노출한다.)

| 파일 | 책임 |
|---|---|
| `web/js/config.js` | `APP_CONFIG = { GAS_URL, OAUTH_CLIENT_ID, MOCK }` |
| `web/js/api.js` | 호출 헬퍼, 캐시(§6.1), `busy` 재시도, `app:session-expired` 이벤트 |
| `web/js/auth.js` | Google Identity Services 로그인·로그아웃, 토큰 보관, 등록 화면 진입 판정 |
| `web/js/state.js` | 세션·현재 탭·로드된 데이터 보관, `resetAll()` |
| `web/js/stats.js` | **순수 함수**(§3). 부수효과 없음, Node에서 테스트 가능 |
| `web/js/mccheyne-plan.js` | `getReadings(dateStr)` (선행 저장소에서 복사, 내용 무수정) |
| `web/js/view-today.js` / `view-calendar.js` / `view-prayer.js` / `view-library.js` / `view-class.js` | 각 탭 |
| `web/css/app.css` | 디자인 토큰 + 컴포넌트 |

### 6.1 프론트 캐시 — 사용자 격리 (보안 규정)

이 앱은 **가정에서 한 휴대폰을 학생과 학부모가 공유하는 것이 기본 시나리오**다.
계정 전환 시 캐시가 남으면 자녀의 기도제목이 부모 화면에 뜬다. 다음을 **반드시** 지킨다.

1. 캐시 키는 `` `${세션 email}|${action}|${JSON.stringify(params)}` `` 형태로 **email을 접두**한다.
2. 캐시는 **모듈 스코프 `Map`(메모리)에만** 둔다. `localStorage`·`sessionStorage`에 기록하지 않는다.
3. 다음 중 하나라도 발생하면 **api 캐시와 `state.js`의 로드된 데이터 전체를 동기적으로 파기한 뒤** 렌더한다:
   - 로그아웃, `app:session-expired`, 계정 전환, `whoami` 응답 email이 직전 세션과 다를 때
4. TTL 2분. 쓰기 액션은 `WRITE_INVALIDATES`로 관련 키를 즉시 무효화한다
   (`setRecord` → `getMyRecords`; 기도 쓰기 → `getMyPrayers`).
5. `scripts/check-web.mjs`가 (1)·(2)를 정적으로 검사한다.

`MOCK`이 문자열이면 GIS 로그인을 건너뛰고 그 email의 모의 사용자로 진입한다(개발·E2E 전용).
**커밋 전 반드시 placeholder로 복원**하며 `scripts/check-web.mjs`가 이를 검사한다.

### 6.2 서비스워커 (PWA)

- 캐시 대상은 **`web/data/*.json`과 정적 자산(HTML/CSS/JS/아이콘)뿐**이며 cache-first로 제공한다.
- **GAS 호출(POST)은 절대 캐시하지 않는다.**
- 캐시명에 `BUILD_TAG`를 포함한다. 새 SW는 `skipWaiting` + `clients.claim`으로 즉시 활성화하고
  활성화 시 구 캐시를 삭제한다. 그렇지 않으면 홈 화면에 추가한 사용자에게 구버전이 며칠간 남는다.

### 6.3 오프라인 동작

오프라인·네트워크 실패 시 저장을 **큐잉하지 않고 즉시 실패를 안내한다**(v1). 입력 내용은 화면에 유지한다.
백그라운드 동기화는 v1 범위 밖이다.

## 7. 화면

| 탭 | 내용 |
|---|---|
| 오늘 | 표준 오늘 날짜 + 맥체인 본문 4개(가정/개인) 카드, 말씀읽음 체크(pill), 와닿은말씀 textarea, 결단 textarea, 중보기도 체크(pill), 저장(전송 중 disabled). "어제 기록" 전환 링크 |
| 달력 | 월 달력 그리드(월요일 시작). 날짜별 상태 점: 기록완료 / 미기록 / 미래. 상단에 streak·이번달 달성률·중보기도 카운터. 좌우 화살표로 월 이동 — **하한은 `joinedAt`의 달**(없으면 가장 오래된 기록의 달), 상한은 이번 달. 날짜 탭 → 그날 기록 바텀시트(읽기 전용). 오늘·어제만 "수정하기" 노출 |
| 기도 | 상단 새 기도제목 입력. 아래 월별 섹션(최신 월 우선). **미응답 = 카드 펼침 상태로 상시 표시**, **응답됨 = `7/12 · 응답됨` 한 줄로 접힘 → 탭하면 펼침**. 각 카드에 응답 체크·삭제 |
| 자료 | 문서 목록 → 문서 열기 → 목차/문답 리스트. 상단 문서 내 검색. 하단에 출처·이용조건 표기 |
| 우리반 | (teacher/admin) 학생·학부모 구분 탭 → 최근 7일 ○/× 그리드 + 달성률, 구성원 탭 → 상세 바텀시트(email 병기). 기도제목 열람(읽기 전용 — 응답 체크·삭제 불가). streak은 `{windowDays}+` 표기 규칙 적용 |
| (공통) | **설정/프로필 영역에 로그아웃 버튼** — 토큰 폐기 + 캐시·state 전체 파기 + 로그인 화면 복귀. 공용 기기에서 세션을 끊을 유일한 수단이므로 필수다 |

- 도메인 색: `--dev-read` green(말씀읽음), `--dev-verse` blue(와닿은말씀), `--dev-resolve` violet(결단), `--dev-prayer` orange(중보기도)

## 8. 배포

### 8.1 배포 설정 (최초 1회, 이후 변경 금지) — 요구사항 8의 근거

> **웹앱 배포 설정: 실행 대상 = "나(소유자 계정)", 액세스 권한 = "모든 사용자".**
> 이 조합이 요구사항 8을 성립시킨다 — 시트는 소유자 계정으로만 열리고 사용자에게 시트를 공유하지 않는다.
> **어떤 경우에도 스프레드시트를 공유하지 않는다.**

"사용자로 실행"으로 배포하면 각 사용자의 권한으로 시트를 열려 하므로 전원 실패한다.
이때 비개발자가 문제를 고치려고 **시트를 공유해 버리면 요구사항 8이 즉시 붕괴한다.**
이 앱에서 가장 개연성 높은 보안 사고 경로이므로 `docs/ops/`에 경고와 함께 반복 기재한다.

### 8.2 스크립트 속성 (3개)

| 키 | 용도 | 없을 때 |
|---|---|---|
| `SHEET_ID` | 데이터 스프레드시트 ID | `server_misconfig` |
| `OAUTH_CLIENT_ID` | ID 토큰 `aud` 검증값 | `server_misconfig` |
| `REGISTER_CODE` | 자가등록 코드. **빈 값이면 등록 폐쇄** | `registration_closed` |

### 8.3 배포 순서

1. GAS: 코드 반영 후 **반드시 "배포 관리 → 기존 배포 수정 → 새 버전"** (새 배포 금지 — URL이 바뀌면 프론트가 구 백엔드를 호출)
2. 프론트: **서비스워커 캐시 버전(`BUILD_TAG`) 갱신을 확인한 뒤** push (Pages 자동 재배포)

`doGet`은 `{ok:true, service, build}` 헬스체크로 두고 `BUILD_TAG`로 배포 반영 여부를 확인한다.

## 9. v1 범위 밖 (명시적 제외)

- 학부모–자녀 계정 연결 및 자녀 기록 열람 (사용자 결정 2026-07-30)
- 교사의 기도 응답 체크 (본인만 — 사용자 결정 2026-07-30)
- 기도제목 수정(`updatePrayer`)·응답메모 — 요구사항 근거 없음. 오입력은 삭제 후 재등록으로 처리
- 독려 메시지 — 요구사항 목록에 없음 (선행 저장소에는 있었으나 계승하지 않는다)
- 계정 탈퇴 API — `docs/ops/`의 **수동 절차**로 처리한다(§ 운영 문서):
  ①명부 행의 `active`를 `FALSE` ②요청 시 `RECORDS_*`·`PRAYERS`의 해당 email 행을 삭제
  (행 삭제는 **앱 사용이 없는 시간대에** 수행 — §2.0)
- 푸시 알림, 이메일 발송, 오프라인 저장 큐잉, 기록 히트맵
- 과거 날짜(2일 이전) 기록 수정
