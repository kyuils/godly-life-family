// Auth.gs — Google ID Token 검증 + 명부 조회(구분·역할 판정).
// 계약: docs/specs/2026-07-30-api-contract.md §0.1, §2.4, §4.4
//
// 보안 불변식 1: 서버는 검증된 토큰의 email만 신뢰한다. 권한에 영향을 주는 값
// (role·교사 여부·active)은 어떤 경우에도 클라이언트 입력을 반영하지 않는다.

const MEMBER_CACHE_PREFIX = 'MEMBER_v1_';
const MEMBER_CACHE_TTL = 60; // 초 (계약 §4.4)

/**
 * ID 토큰을 tokeninfo 엔드포인트로 검증한다.
 * 성공: { ok: true, email }  / 실패: { ok: false, code }
 */
function verifyIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    return { ok: false, code: 'no_token' };
  }
  const props = PropertiesService.getScriptProperties();
  const expectedAud = props.getProperty('OAUTH_CLIENT_ID');
  if (!expectedAud) {
    return { ok: false, code: 'server_misconfig' };
  }

  // 토큰 다이제스트로 5분 캐시. tokeninfo 왕복은 매 액션마다 200~500ms가 들고,
  // 같은 토큰이 클라이언트에서 약 1시간 재사용되므로 대부분의 요청에서 이 홉이 사라진다.
  // 키로는 SHA-256 해시만 쓴다 — 원본 토큰은 캐시에 들어가지 않는다.
  // 히트할 때마다 exp를 다시 확인하므로 만료된 토큰이 캐시로 연장되지 않는다.
  const tokCache = CacheService.getScriptCache();
  let tokKey = null;
  try {
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken, Utilities.Charset.UTF_8);
    tokKey = 'TOK_v1_' + Utilities.base64EncodeWebSafe(digest);
    const hit = tokCache.get(tokKey);
    if (hit) {
      const o = JSON.parse(hit);
      if (Number(o.exp) > Math.floor(Date.now() / 1000)) {
        return { ok: true, email: o.email };
      }
      tokCache.remove(tokKey);
    }
  } catch (e) { /* 캐시 실패가 인증을 막아서는 안 된다 */ }

  let info;
  try {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) {
      return { ok: false, code: 'invalid_token' };
    }
    info = JSON.parse(res.getContentText());
  } catch (e) {
    return { ok: false, code: 'tokeninfo_failed' };
  }

  if (info.aud !== expectedAud) return { ok: false, code: 'aud_mismatch' };
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') {
    return { ok: false, code: 'iss_mismatch' };
  }
  if (Number(info.exp) <= Math.floor(Date.now() / 1000)) return { ok: false, code: 'token_expired' };
  if (!info.email || info.email_verified !== 'true') {
    return { ok: false, code: 'email_unverified' };
  }

  const result = { ok: true, email: String(info.email).toLowerCase().trim() };
  if (tokKey) {
    try {
      tokCache.put(tokKey, JSON.stringify({ email: result.email, exp: Number(info.exp) }), 300);
    } catch (e) { /* ignore */ }
  }
  return result;
}

// kind → 시트에 기록하는 한국어 라벨 (RECORDS/PRAYERS의 '구분' 열).
function kindLabel_(kind) {
  if (kind === 'teacher') return '교사';
  if (kind === 'parent') return '학부모';
  return '학생';
}

// 한 명부 시트에서 email이 일치하고 active인 행을 찾는다. 없으면 null.
function findActiveInSheet_(sheetName, lowerEmail) {
  const rows = readTable_(sheetName).rows;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (String(r.email || '').toLowerCase().trim() !== lowerEmail) continue;
    if (!isActive_(r.active)) continue; // 비활성 행은 후보에서 완전히 제외 (계약 §2.4)
    return r;
  }
  return null;
}

/**
 * 명부 조회 (계약 §2.4).
 *
 * 판정 절차 — 순서 고정:
 *   1) 세 시트에서 email 일치 + active 인 행만 후보로 수집
 *   2) 후보 0개 → null (unauthorized). 비활성 행만 있는 경우도 여기에 해당
 *   3) 우선순위 교사 > 학부모 > 학생 중 최상위 채택
 *
 * "교사 시트에 행이 있으면 즉시 teacher"로 구현하면 해임된(비활성) 교사가 권한을
 * 유지하거나, 반대로 학생 시트에 정상 등재된 사람이 잠긴다. 둘 다 금지다.
 *
 * @return { email, name, role, kind, extra, joinedAt } | null
 */
function lookupMember(email) {
  const lower = String(email).toLowerCase().trim();
  const cache = CacheService.getScriptCache();
  const cacheKey = MEMBER_CACHE_PREFIX + lower;

  const cached = safeCacheGet_(cache, cacheKey);
  if (cached) {
    // 미등재 결과도 캐시한다 — 캐시하지 않으면 미등재 사용자의 반복 호출이 매번
    // 3개 시트 전체 스캔을 유발한다 (계약 §4.4).
    return cached.found ? cached.member : null;
  }

  const teacher = findActiveInSheet_(SHEET_NAMES.MEMBERS_TEACHER, lower);
  const parent = teacher ? null : findActiveInSheet_(SHEET_NAMES.MEMBERS_PARENT, lower);
  const student = (teacher || parent) ? null : findActiveInSheet_(SHEET_NAMES.MEMBERS_STUDENT, lower);

  let member = null;
  if (teacher) {
    // 명부는 사람이 손으로 편집한다 — 공백·대소문자 흔들림을 허용한다.
    const raw = String(teacher['역할'] || '').trim().toLowerCase();
    member = {
      email: lower,
      name: String(teacher['이름'] || ''),
      role: raw === 'admin' ? 'admin' : 'teacher',
      kind: 'teacher',
      extra: '',
      joinedAt: formatDate_(teacher['가입시각']),
    };
  } else if (parent) {
    member = {
      email: lower,
      name: String(parent['이름'] || ''),
      role: 'parent',
      kind: 'parent',
      extra: String(parent['자녀이름'] || ''),
      joinedAt: formatDate_(parent['가입시각']),
    };
  } else if (student) {
    member = {
      email: lower,
      name: String(student['이름'] || ''),
      role: 'student',
      kind: 'student',
      extra: String(student['학년반'] || ''),
      joinedAt: formatDate_(student['가입시각']),
    };
  }

  safeCachePut_(cache, cacheKey, { found: !!member, member: member }, MEMBER_CACHE_TTL);
  return member;
}

function invalidateMemberCache_(email) {
  safeCacheRemove_(CacheService.getScriptCache(), MEMBER_CACHE_PREFIX + String(email).toLowerCase().trim());
}

/**
 * 토큰 검증 + 명부 조회를 묶은 것. 모든 액션의 첫 줄에서 호출한다.
 * @return { ok:true, email, name, role, kind, extra, joinedAt } | { ok:false, code, email? }
 */
function authenticate(body) {
  const v = verifyIdToken(body && body.idToken);
  if (!v.ok) return v;
  const m = lookupMember(v.email);
  if (!m) return { ok: false, code: 'unauthorized', email: v.email };
  return {
    ok: true,
    email: m.email,
    name: m.name,
    role: m.role,
    kind: m.kind,
    extra: m.extra,
    joinedAt: m.joinedAt,
  };
}

// v1에서 admin은 teacher와 동일 취급 (계약 §2.3).
function isTeacher_(auth) {
  return auth.role === 'teacher' || auth.role === 'admin';
}
