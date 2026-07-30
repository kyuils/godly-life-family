// web/js/state.js — 세션·화면·로드된 데이터 보관.
// 계약 §6.1: 로그아웃·계정 전환 시 resetAll()로 전부 파기한다.

export const state = {
  session: null,      // { email, name, role, kind, extra, joinedAt }
  tab: 'today',
  months: [],         // 로드된 달 목록 (YYYY-MM)
  records: [],        // 본인 기록 (MyRecord[])
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
