// 증상 기반 추천: 증상 문장 → AI 증상 분류(분류만) → 사용자 확인 → 규칙표로 역량 판정 → 이동시간순 1~5순위.
// 판정 규칙은 서버의 /api/rules(data/recommendation_rules.json)에서 읽는다. Pre-KTAS는 자문 후 규칙표에 추가한다.
(() => {
  const $ = selector => document.querySelector(selector);
  const form = $("#symptom-search");
  const input = $("#symptom-query");
  const button = $("#symptom-button");
  const status = $("#symptom-status");
  const dialog = $("#symptom-confirm");
  const categorySelect = $("#confirm-category");
  const keywordsText = $("#confirm-keywords");
  const childBox = $("#confirm-child");
  const minutesInput = $("#rec-minutes");
  const typeSelect = $("#rec-type");
  const requiredText = $("#confirm-required");
  const note = $("#symptom-note");
  const area = $("#recommend-area");
  const areaStatus = $("#recommend-status");
  const results = $("#recommend-results");
  const unknownBox = $("#recommend-unknown");
  const unknownList = $("#recommend-unknown-list");
  const unknownSummary = $("#recommend-unknown-summary");
  const notice = $("#recommend-notice");
  let rules = null;
  let request = null;

  async function loadRules() {
    if (rules) return rules;
    const response = await fetch("/api/rules", {cache: "no-store"});
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.categories) throw new Error("추천 규칙표를 읽지 못했어요.");
    rules = body;
    categorySelect.replaceChildren();
    for (const category of rules.categories) categorySelect.add(new Option(category.label, category.id));
    for (const badge of document.querySelectorAll(".rules-badge")) {
      badge.textContent = rules.status + (rules.pre_ktas?.enabled ? "" : " · Pre-KTAS " + (rules.pre_ktas?.notice || "미적용"));
    }
    return rules;
  }

  function category(id) {
    return rules.categories.find(item => item.id === id) || rules.categories.find(item => item.id === "unclear");
  }

  function fillTypes() {
    if (typeSelect.options.length > 1 || !window.medinaviData) return;
    const types = [...new Set(window.medinaviData.items.map(hospital => hospital.dutyEmclsName))].filter(Boolean);
    for (const type of types) typeSelect.add(new Option(type, type));
  }

  function describeRequired() {
    const selected = category(categorySelect.value);
    const required = (selected.required || []).map(item => item.name);
    const any = (selected.required_any || []).map(item => item.name);
    const parts = [];
    if (required.length) parts.push("모두 가능해야 일치: " + required.join(", "));
    if (any.length) parts.push("하나 이상 가능하면 일치: " + any.join(" 또는 "));
    requiredText.textContent = parts.length ? parts.join(" / ") : (selected.note || "필수 조건 없이 이동시간순으로 보여줘요.");
  }

  function clearArea() {
    request?.abort();
    request = null;
    results.replaceChildren();
    unknownList.replaceChildren();
    unknownBox.hidden = true;
    areaStatus.textContent = "";
    area.hidden = true;
  }

  // ---- 역량 판정 (공통 판정 judgement.js 사용) ----------------------------
  function evaluate(hospital, selected, isChild) {
    // 소아일 때 규칙표의 child_required를 필수 조건에 더한다 (자문 후 채울 자리).
    const required = [...(selected.required || []), ...(isChild ? rules.child_required || [] : [])];
    const any = selected.required_any || [];
    // 소아 공통 참고 항목이 분류의 필수·참고 항목과 겹치면 한 번만 보여준다.
    const same = (a, b) => a.type === b.type && a.name === b.name;
    const reference = [...(selected.reference || []), ...(isChild ? rules.child_reference || [] : [])]
      .filter((item, index, list) => list.findIndex(other => same(other, item)) === index && ![...required, ...any].some(other => same(other, item)));
    return window.medinaviJudge.evaluate(hospital, {required, any, reference});
  }

  // ---- 추천 실행 --------------------------------------------------------
  async function recommend(selectedId, isChild, maxMinutes, type) {
    document.dispatchEvent(new CustomEvent("medinavi-search", {detail: "recommend"}));
    clearArea();
    area.hidden = false;
    const data = window.medinaviData;
    const origin = currentLocation;
    if (!origin) {
      areaStatus.textContent = "'내 위치'를 확인하거나 출발지 주소를 먼저 지정해 주세요.";
      return;
    }
    const controller = new AbortController();
    request = controller;
    const selected = category(selectedId);
    areaStatus.textContent = "실시간 정보를 확인하고 있어요.";
    await window.medinaviRealtime?.refresh();
    if (controller.signal.aborted) return;

    const evaluated = data.items
      .filter(hospital => !type || hospital.dutyEmclsName === type)
      .map(hospital => ({hospital, ...evaluate(hospital, selected, isChild)}));
    const excluded = evaluated.filter(entry => entry.verdict === "불일치").length;

    areaStatus.textContent = "병원별 예상 이동시간을 조회하고 있어요.";
    const routed = await window.medinaviJudge.lookupRoutes(evaluated.filter(entry => entry.verdict !== "불일치"), origin, controller.signal);
    if (!routed) return;
    const noRoute = routed.filter(entry => !entry.route).length;
    const within = routed.filter(entry => entry.route && entry.route.duration_ms <= maxMinutes * 60000)
      .sort((a, b) => a.route.duration_ms - b.route.duration_ms);
    const recommended = within.filter(entry => entry.verdict === "일치").slice(0, 5);
    const unknown = within.filter(entry => entry.verdict === "확인 필요");

    recommended.forEach((entry, index) => {
      const {hospital, route, checks} = entry;
      const item = document.createElement("li");
      const choice = document.createElement("button");
      choice.type = "button";
      choice.dataset.hpid = hospital.hpid;
      const minutes = Math.ceil(route.duration_ms / 60000);
      const distance = (route.distance_m / 1000).toFixed(1);
      const required = checks.filter(check => check.kind !== "reference");
      const reference = checks.filter(check => check.kind === "reference").slice(0, 4);
      const checkText = window.medinaviJudge.checkText;
      let text = (index + 1) + ". " + hospital.dutyName + " (" + (hospital.dutyEmclsName || "구분 확인 필요") + ") · 약 " + minutes + "분 · " + distance + "km";
      if (required.length) text += "\n조건: " + required.map(checkText).join(" · ");
      if (reference.length) text += "\n참고: " + reference.map(checkText).join(" · ");
      const realtimeText = window.medinaviRealtime?.summary(hospital.hpid);
      if (realtimeText) text += "\n" + realtimeText;
      choice.textContent = text;
      const congestion = window.medinaviRealtime?.level(hospital.hpid);
      if (congestion) choice.dataset.congestion = congestion;
      choice.onclick = () => showHospitalDetail(hospital, data, route);
      item.append(choice);
      results.append(item);
    });
    for (const {hospital, route, checks} of unknown) {
      const item = document.createElement("li");
      const reasons = checks.filter(check => check.kind !== "reference" && check.status !== "가능").map(window.medinaviJudge.checkText);
      item.textContent = hospital.dutyName + " · 약 " + Math.ceil(route.duration_ms / 60000) + "분 — " + reasons.join(", ");
      unknownList.append(item);
    }
    unknownBox.hidden = unknown.length === 0;
    // 5곳이 넘으면 접어 두고 개수만 보여준다.
    unknownSummary.textContent = "조건 확인 필요 (" + unknown.length + "곳)";
    unknownBox.open = unknown.length <= 5;
    window.hospitalRouteView?.showSearchResults(recommended);

    const summary = [
      selected.label,
      "예상 " + maxMinutes + "분 이내 조건 일치 " + recommended.length + "곳" + (within.filter(e => e.verdict === "일치").length > 5 ? " (상위 5곳 표시)" : ""),
      unknown.length && "조건 확인 필요 " + unknown.length + "곳",
      excluded && "조건 불일치 " + excluded + "곳 제외",
      noRoute && "이동시간 확인 불가 " + noRoute + "곳",
    ].filter(Boolean);
    // 결과가 없으면 어디서 줄었는지 단계별로 알려준다.
    const funnel = "후보 " + evaluated.length + "곳 → 조건 일치 " + routed.filter(e => e.verdict === "일치").length + "곳 → " + maxMinutes + "분 이내 0곳";
    areaStatus.textContent = summary.join(" · ") + (recommended.length ? "" : ". [" + funnel + "] 조건을 넓히거나 확인 필요 목록의 병원에 연락해 주세요.");
    notice.textContent = (selected.note ? selected.note + " " : "") + rules.notice + " 예상 시간은 일반 자동차 기준 참고값이에요.";
    request = null;
  }

  // ---- 화면 이벤트 ------------------------------------------------------
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query || button.disabled) return;
    if (!window.medinaviData) {
      status.textContent = "지도를 준비하고 있어요. 잠시 후 다시 시도해 주세요.";
      return;
    }
    button.disabled = true;
    status.textContent = "증상을 분류하고 있어요.";
    note.textContent = "";
    try {
      await loadRules();
      fillTypes();
      let parsed = null;
      try {
        const response = await fetch("/api/symptom/parse", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({query})});
        const body = await response.json().catch(() => null);
        if (!response.ok || !body) throw new Error(typeof body?.detail === "string" ? body.detail : "서버를 준비하고 있어요.");
        parsed = body;
      } catch (error) {
        // AI가 실패해도 사용자가 직접 분류를 골라 추천받을 수 있게 한다.
        note.textContent = (error.message || "AI 증상 분류에 실패했어요.") + " 증상 분류를 직접 골라 주세요.";
      }
      categorySelect.value = parsed?.category_id || "unclear";
      keywordsText.textContent = parsed?.symptom_keywords?.length
        ? "AI가 참고한 표현: " + parsed.symptom_keywords.map(word => "'" + word + "'").join(", ")
        : "AI가 참고한 표현 없음";
      childBox.checked = parsed?.is_child === true;
      if (parsed?.max_minutes) minutesInput.value = parsed.max_minutes;
      describeRequired();
      status.textContent = "";
      dialog.showModal();
    } catch (error) {
      status.textContent = error.message || "증상 분류를 준비하지 못했어요.";
    } finally {
      button.disabled = false;
    }
  });

  categorySelect.addEventListener("change", describeRequired);
  $("#symptom-edit").addEventListener("click", () => {
    dialog.close();
    input.focus();
  });
  $("#symptom-go").addEventListener("click", () => {
    const maxMinutes = Number(minutesInput.value);
    if (!Number.isSafeInteger(maxMinutes) || maxMinutes < 1 || maxMinutes > 600) {
      note.textContent = "최대 예상 이동시간을 1~600분 사이로 입력해 주세요.";
      return;
    }
    dialog.close();
    recommend(categorySelect.value, childBox.checked, maxMinutes, typeSelect.value);
  });

  // 조건 검색을 하거나 출발지를 바꾸면 이전 추천을 정리한다.
  document.addEventListener("medinavi-search", event => {
    if (event.detail !== "recommend") clearArea();
  });
  document.addEventListener("originchange", clearArea);
  loadRules().catch(() => {});
})();
