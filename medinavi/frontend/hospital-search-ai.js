(() => {
  const form = document.querySelector("#natural-search");
  const input = document.querySelector("#natural-query");
  const parseButton = document.querySelector("#parse-search");
  const status = document.querySelector("#natural-status");
  const dialog = document.querySelector("#search-confirm");
  const confirm = document.querySelector("#confirm-search");
  const edit = document.querySelector("#edit-search");
  const note = document.querySelector("#confirm-note");
  const hospitalForm = document.querySelector("#hospital-search");
  const typeSelect = document.querySelector("#hospital-type");
  const minutesInput = document.querySelector("#max-minutes");
  const searchButton = document.querySelector("#search-button");
  let conditions = null;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query || parseButton.disabled) return;
    conditions = null;
    confirm.disabled = true;
    parseButton.disabled = true;
    input.readOnly = true;
    status.textContent = "검색조건을 해석하고 있어요.";

    try {
      const response = await fetch("/api/search/parse", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({query}),});
      const result = await response.json();
      if (!response.ok) {
        throw new Error(typeof result.detail === "string" ? result.detail: "검색조건을 해석하지 못했어요.");
      }
      const {
        hospital_type: type, max_minutes: minutes, has_unsupported_conditions: unsupported,} = result;
      const validMinutes = Number.isSafeInteger(minutes) && minutes >0;
      document.querySelector("#confirm-type").textContent = type || "입력 필요";
      document.querySelector("#confirm-minutes").textContent = validMinutes ? minutes + "분 이내": "입력 필요";
      const messages = [];
      if (!type || !validMinutes) {
        messages.push("기관 유형과 최대 이동시간을 모두 입력해 주세요.");
      }
      if (unsupported) {
        messages.push("이 검색에서 처리할 수 없는 조건이 있어요. 문장을 수정해 주세요.");
      }
      note.textContent = messages.join(" ");
      if (type && validMinutes && unsupported === false)
      {
        conditions = {type, minutes};
        confirm.disabled = false;
      }
      status.textContent = "";
      dialog.showModal();
    } catch (error) {
      status.textContent = error.message || "검색조건을 해석하지 못했어요.";
    } finally {
      parseButton.disabled = false;
      input.readOnly = false;
    }
  });
  // 조건 수정: 확인 창을 닫고 문장 입력칸으로 돌아간다.
  edit.addEventListener("click", () => {
    dialog.close();
    input.focus();
  });
  // 이 조건으로 검색: 기존 조건 검색 폼에 값을 넣고 실행한다.
  confirm.addEventListener("click", () => {
    if (!conditions) return;
    if (searchButton.disabled) {
      note.textContent = "기존 검색이 준비된 뒤 다시 눌러 주세요.";
      return;
    }
    if (!Array.from(typeSelect.options).some(option => option.value === conditions.type)) {
      note.textContent = "기관 유형을 선택 목록에서 확인해 주세요.";
      return;
    }
    typeSelect.value = conditions.type;
    minutesInput.value = conditions.minutes;
    dialog.close();
    hospitalForm.requestSubmit();
  });
})();
