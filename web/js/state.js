// web/js/state.js — 세션·화면·로드된 데이터 보관.
// 계약 §6.1: 로그아웃·계정 전환 시 resetAll()로 전부 파기한다.

export const state = {
  session: null,      // { email, name, role, kind, extra, joinedAt }
  tab: 'today',
  months: [],         // 달력이 현재 보유한 달 목록 (YYYY-MM)
  records: [],        // 달력 표시용 기록 (달 이동에 따라 교체됨)
  // 상단 지표(연속기록·달성률·중보기도)는 로그인 시 로드한 창으로 **고정**한다.
  // 달력에서 과거로 이동할 때 records를 교체하는데, 지표까지 그걸 쓰면
  // 6개월 창 밖으로 이번 달이 밀려나는 순간 "연속 0일 / 0%"로 표시된다.
  // 사용자는 자기 기록이 사라졌다고 인식한다 (2026-07-30 최종 검토 지적).
  statsRecords: [],
  prayers: [],        // 본인 기도 (Prayer[])
  streakCapped: false,// 6개월 상한에 걸렸는지 (화면에 '+' 표기)
  classRecords: null, // 교사 전용
  classPrayers: null,
  classMembers: null,
  classWindowDays: 60,
  library: null,      // 참고자료 index
  libraryDocs: {},    // id -> 문서 본문 (지연 로드)
};

/** 사용자별 데이터를 전부 비운다. 참고자료(공개 정적 파일)는 유지해도 무방하다. */
export function resetUserData() {
  state.session = null;
  state.tab = 'today';
  state.months = [];
  state.records = [];
  state.statsRecords = [];
  state.prayers = [];
  state.streakCapped = false;
  state.classRecords = null;
  state.classPrayers = null;
  state.classMembers = null;
  state.classWindowDays = 60;
}

export function isTeacher() {
  return !!state.session && (state.session.role === 'teacher' || state.session.role === 'admin');
}
