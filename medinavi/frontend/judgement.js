// 공통 판정: 조건 검색(map.js)과 증상 기반 추천(symptom-recommend.js)이 같은 규칙과
// 신청서의 용어(조회 정보상 '일치' / '불일치' / '확인 필요')를 쓰도록 한곳에 모은다.
(() => {
  const VERDICT = {"가능": "일치", "불가": "불일치", "확인 필요": "확인 필요"};

  // 조건 하나를 병원 자료와 실시간 정보로 확인한다. status는 가능 / 불가 / 확인 필요.
  function resolve(hospital, requirement) {
    const realtime = window.medinaviRealtime;
    const loaded = Boolean(realtime?.isLoaded());
    const missing = loaded ? "실시간 정보 없음" : "실시간 정보를 불러오지 못함";
    if (requirement.type === "illness") {
      const info = loaded ? realtime.illnessStatus(hospital.hpid, requirement.name) : null;
      if (!info) return {status: "확인 필요", detail: missing};
      if (info.status === "확인 필요") return {status: "확인 필요", detail: "병원 정보미제공"};
      // 중증질환 정보에는 갱신 시각이 없어 '병원 입력' 기준임을 함께 밝힌다.
      return {status: info.status, detail: info.status + " · 병원 입력" + (info.note ? " · " + info.note : "")};
    }
    if (requirement.type === "equipment") {
      const value = loaded ? realtime.equipmentStatus(hospital.hpid, requirement.name) : null;
      return value ? {status: value, detail: value} : {status: "확인 필요", detail: missing};
    }
    if (requirement.type === "bed") {
      const count = loaded ? realtime.bedAvailable(hospital.hpid, requirement.name) : null;
      if (count == null) return {status: "확인 필요", detail: "병상 정보 없음"};
      return count > 0 ? {status: "가능", detail: "가용 " + count} : {status: "불가", detail: "가용 " + count + " · 포화"};
    }
    if (requirement.type === "department") {
      const departments = hospital.departments || [];
      if (!departments.length) return {status: "확인 필요", detail: "진료과목 자료 없음"};
      return departments.includes(requirement.name) ? {status: "가능", detail: "등록"} : {status: "불가", detail: "미등록"};
    }
    return {status: "확인 필요", detail: "알 수 없는 조건"};
  }

  // 이 조건과 관련된 병원 공지가 있으면 근거에 덧붙인다. 공지는 병원 입력값이라 판정 자체는 바꾸지 않는다.
  function withNotice(hospital, requirement, result) {
    const related = (window.medinaviRealtime?.notices?.(hospital.hpid) || []).filter(notice =>
      (requirement.type === "illness" && notice.illness === requirement.name) ||
      (requirement.type === "department" && notice.department === requirement.name));
    if (!related.length) return result;
    return {...result, detail: result.detail + " · ⚠ 공지: " + related.map(notice => notice.text).join(" / "), notice: true};
  }

  // required: 모두 가능해야 일치 / any: 하나 이상 가능하면 일치 / reference: 판정에 쓰지 않고 근거로만 표시
  function evaluate(hospital, {required = [], any = [], reference = []} = {}) {
    const check = (list, kind) => list.map(item => ({...item, kind, ...withNotice(hospital, item, resolve(hospital, item))}));
    const requiredChecks = check(required, "required");
    const anyChecks = check(any, "any");
    const referenceChecks = check(reference, "reference");
    let verdict = "일치";
    if (requiredChecks.some(item => item.status === "불가") || (anyChecks.length && anyChecks.every(item => item.status === "불가"))) {
      verdict = "불일치";
    } else if (!requiredChecks.every(item => item.status === "가능") || (anyChecks.length && !anyChecks.some(item => item.status === "가능"))) {
      verdict = "확인 필요";
    }
    return {verdict, checks: [...requiredChecks, ...anyChecks, ...referenceChecks]};
  }

  // 조건은 '일치(근거)', 참고 항목은 근거만 보여준다.
  function checkText(check) {
    if (check.kind === "reference") return check.name + " " + check.detail;
    return check.name + " " + VERDICT[check.status] + "(" + check.detail + ")";
  }

  // 길찾기를 4개씩 나눠 조회한다. 중간에 취소되면 null.
  async function lookupRoutes(entries, origin, signal, lookup = window.medinaviLookupRoute) {
    const routed = [];
    for (let index = 0; index < entries.length; index += 4) {
      const batch = entries.slice(index, index + 4);
      const results = await Promise.all(batch.map(entry => lookup(entry.hospital, origin, signal)));
      if (signal.aborted) return null;
      results.forEach((result, offset) => routed.push({...batch[offset], route: result.route}));
    }
    return routed;
  }

  window.medinaviJudge = {VERDICT, resolve, evaluate, checkText, lookupRoutes};
})();
