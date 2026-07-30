# 04. 화면 인터넷에 올리기 (GitHub Pages)

학생·학부모가 휴대폰으로 접속할 주소를 만듭니다.

## 0. 먼저 선택하실 것

이 저장소는 지금 **비공개(private)** 입니다. GitHub Pages 규칙상:

| 선택 | 비용 | 참고자료 노출 |
|---|---|---|
| **A. 저장소를 공개로 전환** | 무료 | 신앙고백서·요리문답 본문이 인터넷에 공개됨 |
| **B. GitHub Pro 구독 후 비공개 유지** | 월 약 4달러 | 저장소는 비공개, 앱 화면만 공개 |

> **어느 쪽이든 학생·학부모의 기록과 기도제목은 절대 공개되지 않습니다.**
> 그것들은 GitHub이 아니라 선생님의 스프레드시트에 있고, 저장소에는 코드만 있습니다.
> 공개/비공개는 **참고자료 본문과 코드**가 인터넷에 보이느냐의 문제입니다.
>
> 참고자료 출처(예장합동 총회 자료실)에는 "All Rights Reserved" 표기가 있고
> 재사용 허락 문구는 확인되지 않았습니다. 이 점이 마음에 걸리시면 **B**를 권합니다.
> (자세한 경위: `docs/specs/2026-07-30-api-contract.md` §5.5.1)

### A를 선택한 경우
GitHub 저장소 → **Settings** → 맨 아래 **Danger Zone** → **Change repository visibility** → **Public**

### B를 선택한 경우
[github.com/settings/billing](https://github.com/settings/billing) 에서 Pro로 업그레이드

## 1. 앱 설정 파일 채우기

`web/js/config.js` 파일을 열어 두 줄을 채웁니다.

```javascript
export const APP_CONFIG = {
  GAS_URL: '여기에 ③ Apps Script 웹앱 주소',
  OAUTH_CLIENT_ID: '여기에 ② OAuth 클라이언트 ID',
  MOCK: null,          // ← 반드시 null 이어야 합니다
};
```

> `MOCK`은 개발자가 로그인 없이 테스트할 때 쓰는 값입니다.
> **null이 아니면 아무나 남의 계정으로 들어올 수 있습니다.**
> `npm test`가 이걸 검사하므로, 실수로 바뀌면 검사에서 걸립니다.

저장한 뒤 GitHub에 올립니다:

```bash
git add web/js/config.js && git commit -m "chore: 배포 설정 입력" && git push
```

## 2. GitHub Pages 켜기

1. GitHub 저장소 → **Settings** → 왼쪽 **Pages**
2. **Source**: `Deploy from a branch`
3. **Branch**: `main` / 폴더는 **`/ (root)`** → **Save**

> ⚠️ 폴더 선택지에 `/web`이 없습니다. 그래서 다음 단계가 필요합니다.

## 3. 시작 페이지 만들기

저장소 맨 위에 `index.html` 파일을 만들어 `web/` 로 보내줍니다.
(이미 저장소에 포함되어 있으면 이 단계는 건너뜁니다)

파일 이름: `index.html` (저장소 최상위)

```html
<!doctype html>
<meta charset="utf-8">
<title>경건생활</title>
<meta http-equiv="refresh" content="0; url=./web/">
<a href="./web/">경건생활 앱으로 이동</a>
```

```bash
git add index.html && git commit -m "chore: 루트에서 web/으로 이동" && git push
```

## 4. 주소 확인

1~2분 뒤 아래 주소로 접속됩니다:

```
https://<GitHub 아이디>.github.io/godly-life-family/
```

예: `https://kyuils.github.io/godly-life-family/`

## 5. ★ 구글에 이 주소 등록하기 (빠뜨리기 쉬움)

01번 문서로 돌아가서, **승인된 JavaScript 원본**에 아래를 추가해야 로그인이 됩니다.

```
https://kyuils.github.io
```

> 주소 끝에 `/`나 `/godly-life-family`를 붙이면 **안 됩니다.** 도메인까지만 넣습니다.

[사용자 인증 정보](https://console.cloud.google.com/apis/credentials) → 만든 OAuth 클라이언트 클릭
→ **승인된 JavaScript 원본**에 추가 → **저장**

반영에 몇 분 걸립니다.

## 6. 학생·학부모에게 알릴 것

카톡 등으로 아래 두 가지를 보내시면 됩니다.

```
경건생활 앱 주소: https://kyuils.github.io/godly-life-family/
가입 코드: hyerim2026

▸ 구글 계정으로 로그인 → 학생/학부모 선택 → 이름과 코드 입력하면 바로 시작됩니다.
▸ 휴대폰에서 열고 «홈 화면에 추가»하면 앱처럼 쓸 수 있어요.
```

**홈 화면에 추가하는 법**
- 아이폰(Safari): 아래 공유 버튼 → "홈 화면에 추가"
- 안드로이드(Chrome): 오른쪽 위 ⋮ → "홈 화면에 추가"

## 이럴 때는

**404 페이지가 나와요**
→ Pages 반영에 최대 몇 분 걸립니다. Settings → Pages 화면 위쪽에 초록색으로 주소가 뜨는지 확인하세요.

**"아직 서버 주소가 설정되지 않았습니다"**
→ 1번의 `GAS_URL`이 아직 `PASTE_...` 상태입니다. 채우고 push하세요.

**로그인 버튼이 안 보여요 / 눌러도 반응이 없어요**
→ 5번(승인된 JavaScript 원본)을 안 했거나 주소가 틀렸습니다. 가장 흔한 원인입니다.

**고쳤는데 화면이 그대로예요**
→ 휴대폰에 앱이 저장(캐시)되어 있어서입니다. 브라우저를 완전히 껐다 켜거나,
   홈 화면 아이콘을 지우고 다시 추가하세요.
   (배포할 때 `web/sw.js`의 `BUILD_TAG`를 올리면 자동으로 갱신됩니다)

---

다음: [05-test-checklist.md](05-test-checklist.md)
