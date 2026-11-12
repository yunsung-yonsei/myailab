// 실시간 병상·중증질환 수용 가능 정보를 불러와 검색 결과와 병원 상세정보에 보여준다.
// 서버의 /api/realtime이 국립중앙의료원 자료를 정리해 주며, 실제 수용 가능 여부를 뜻하지 않는다.
(() => {
  const MAX_AGE_MS = 120000;     // 2분이 지나면 새로 불러온다.
  const STALE_MINUTES = 30;      // 병원 갱신 시각이 30분을 넘으면 '갱신 지연'으로 표시한다.
  const STATUS_ORDER = ["가능", "불가", "확인 필요"];
  let data = null;
  let fetchedAt = 0;
  let pending = null;
  let error = "";
  let currentHospital = null;

  function refresh(force = false) {
    if (!force && data && Date.now() - fetchedAt < MAX_AGE_MS) return Promise.resolve(data);
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetch("/api/realtime", {cache: "no-store"});
        const body = await response.json().catch(() => null);
        if (!response.ok || !body) {
          throw new Error(typeof body?.detail === "string" ? body.detail : "서버를 준비하고 있어요. 잠시 후 다시 확인해 주세요.");
        }
        data = body;
        fetchedAt = Date.now();
        error = "";
      } catch (e) {
        error = e.message || "실시간 정보를 불러오지 못했어요.";
      } finally {
        pending = null;
      }
      if (currentHospital) renderDetail(currentHospital);
      return data;
    })();
    return pending;
  }

  function minutesAgo(iso) {
    const time = new Date(iso || "").getTime();
    return Number.isFinite(time) ? Math.max(0, Math.round((Date.now() - time) / 60000)) : null;
  }

  // 응급실 혼잡도: 가용/전체가 50% 이상 원활, 20~50% 보통, 20% 미만 혼잡, 0 이하는 포화 (팀 결정 2026-11-12)
  function congestion(available, total) {
    if (available == null) return "";
    if (available <= 0) return "포화";
    if (!(total > 0)) return "";
    const ratio = available / total;
    return ratio >= 0.5 ? "원활" : ratio >= 0.2 ? "보통" : "혼잡";
  }

  // 0 이하는 병상보다 환자가 많은 포화 상태다. (음수는 대기 환자 수)
  function bedText(count, total = null) {
    const level = congestion(count, total);
    const shown = total > 0 ? count + "/" + total : String(count);
    if (count > 0) return shown + (total > 0 ? " (" + level + ")" : "");
    return shown + " (포화" + (count < 0 ? " · 대기 " + -count : "") + ")";
  }

  function ageText(age) {
    if (age == null) return "갱신 시각 확인 필요";
    return age > STALE_MINUTES ? age + "분 전 · 갱신 지연" : age + "분 전";
  }

  // 검색 결과 목록에 붙일 한 줄 요약
  function summary(hpid) {
    if (!data) return error ? "실시간 병상 확인 필요" : "";
    const info = data.hospitals?.[hpid];
    if (!info?.has_beds || info.er_available == null) return "응급실 실시간 정보 없음";
    return "응급실 " + bedText(info.er_available, info.er_total) + " · " + ageText(minutesAgo(info.updated_at));
  }

  // 검색 결과 색 표시용 혼잡도 (원활 / 보통 / 혼잡 / 포화)
  function level(hpid) {
    const info = data?.hospitals?.[hpid];
    return info?.has_beds ? congestion(info.er_available, info.er_total) : "";
  }

  function isLoaded() {
    return Boolean(data);
  }

  // 증상 기반 추천용: 장비 상태(가능/불가) 또는 정보 없음(null)
  function equipmentStatus(hpid, label) {
    return data?.hospitals?.[hpid]?.equipment?.find(item => item.label === label)?.status || null;
  }

  // 증상 기반 추천용: 가용 병상 수 또는 정보 없음(null)
  function bedAvailable(hpid, label) {
    const bed = data?.hospitals?.[hpid]?.beds?.find(item => item.label === label);
    return bed ? bed.available : null;
  }

  // 중증질환 검색 조건용: {label, status, note} 또는 정보 없음(null)
  function illnessStatus(hpid, label) {
    const info = data?.hospitals?.[hpid];
    if (!info?.has_illness) return null;
    return info.illness.find(item => item.label === label) || null;
  }

  function heading(text) {
    const element = document.createElement("h4");
    element.textContent = text;
    return element;
  }

  function addList(body, title, lines) {
    if (!lines.length) return;
    const list = document.createElement("ul");
    for (const line of lines) {
      const item = document.createElement("li");
      item.textContent = line;
      list.append(item);
    }
    body.append(heading(title), list);
  }

  // 가능 / 불가 / 확인 필요로 묶어 보여준다.
  function addStatusGroups(body, title, entries) {
    if (!entries.length) return;
    body.append(heading(title));
    for (const status of STATUS_ORDER) {
      const names = entries.filter(entry => entry.status === status).map(entry => entry.label);
      if (!names.length) continue;
      const label = document.createElement("strong");
      label.textContent = status + " (" + names.length + ") ";
      // '확인 필요'는 항목이 많아 접어 두고, 누르면 펼쳐 볼 수 있게 한다.
      const line = document.createElement(status === "확인 필요" ? "details" : "p");
      line.className = "realtime-status";
      line.dataset.status = status;
      if (status === "확인 필요") {
        const toggle = document.createElement("summary");
        toggle.append(label);
        line.append(toggle, names.join(", "));
      } else {
        line.append(label, names.join(", "));
      }
      body.append(line);
    }
  }

  function renderDetail(hospital) {
    currentHospital = hospital;
    const section = document.querySelector("#realtime-detail");
    const meta = document.querySelector("#realtime-meta");
    const body = document.querySelector("#realtime-body");
    if (!section) return;
    section.hidden = false;
    body.replaceChildren();
    meta.classList.remove("stale");
    if (!data) {
      meta.textContent = error || "실시간 정보를 불러오고 있어요.";
      if (!error) refresh();
      return;
    }
    const info = data.hospitals?.[hospital.hpid];
    if (!info) {
      meta.textContent = "이 기관은 실시간 정보를 제공하지 않아요. 병원에 직접 확인해 주세요.";
      return;
    }
    const age = minutesAgo(info.updated_at);
    const stale = age != null && age > STALE_MINUTES;
    meta.textContent = !info.has_beds ? "병상 정보 없음 (중증질환 정보만 제공)"
      : age == null ? "갱신 시각 확인 필요"
      : age + "분 전 갱신" + (stale ? " · 갱신이 늦어 지금과 다를 수 있어요. 확인 필요" : "");
    meta.classList.toggle("stale", stale);
    addList(body, "가용 병상", info.beds.map(bed => bed.label + " " + bedText(bed.available, bed.total)));
    addStatusGroups(body, "시설·장비", info.equipment);
    addStatusGroups(body, "중증질환 수용 가능 (병원 입력 기준)",
      info.illness.map(item => ({label: item.label + (item.note ? " (" + item.note + ")" : ""), status: item.status})));
    if (data.errors?.length) {
      const warning = document.createElement("p");
      warning.className = "stale";
      warning.textContent = "일부 정보를 불러오지 못했어요: " + data.errors.join(", ");
      body.append(warning);
    }
  }

  window.medinaviRealtime = {refresh, summary, level, isLoaded, illnessStatus, equipmentStatus, bedAvailable, renderDetail};
  refresh();
  // 화면을 보고 있는 동안에는 2분마다 새로 불러온다.
  setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, MAX_AGE_MS);
})();
