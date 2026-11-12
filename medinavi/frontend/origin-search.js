// 주소를 검색해 출발지로 지정한다. 좌표 변환은 서버의 /api/geocode가 네이버 Geocoding으로 처리한다.
(() => {
  const form = document.querySelector("#origin-search");
  const input = document.querySelector("#origin-query");
  const button = document.querySelector("#origin-button");
  const status = document.querySelector("#origin-status");
  const results = document.querySelector("#origin-results");
  let request = null;

  function clearResults() {
    request?.abort();
    request = null;
    results.replaceChildren();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    if (typeof window.setAddressOrigin !== "function") {
      status.textContent = "지도를 준비하고 있어요. 잠시 후 다시 검색해 주세요.";
      return;
    }
    clearResults();
    const controller = new AbortController();
    request = controller;
    button.disabled = true;
    status.textContent = "주소를 찾고 있어요.";
    try {
      const response = await fetch("/api/geocode?" + new URLSearchParams({query}), {signal: controller.signal, cache: "no-store"});
      const data = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok || !data) {
        throw new Error(typeof data?.detail === "string" ? data.detail : "서버를 준비하고 있어요. 잠시 후 다시 검색해 주세요.");
      }
      if (!data.results.length) {
        status.textContent = "주소를 찾지 못했어요. 시·군과 도로명, 건물번호까지 입력해 보세요. (예: 강릉시 강릉대로 33)";
        return;
      }
      status.textContent = data.results.length === 1 ? "이 주소가 맞으면 눌러 출발지로 지정하세요." : "출발지로 쓸 주소를 골라 주세요.";
      for (const address of data.results) {
        const label = address.road_address || address.jibun_address || "주소 정보 없음";
        const item = document.createElement("li");
        const choice = document.createElement("button");
        choice.type = "button";
        choice.textContent = label + (address.road_address && address.jibun_address ? "\n(지번) " + address.jibun_address : "");
        choice.style.whiteSpace = "pre-line";
        choice.onclick = () => {
          clearResults();
          window.setAddressOrigin(address.latitude, address.longitude, label);
          status.textContent = "출발지를 지정했어요: " + label;
        };
        item.append(choice);
        results.append(item);
      }
    } catch (error) {
      if (!controller.signal.aborted) status.textContent = error.message || "주소를 검색하지 못했어요.";
    } finally {
      if (request === controller) request = null;
      button.disabled = false;
    }
  });

  // 입력을 고치면 이전 후보를 지운다.
  input.addEventListener("input", () => {
    if (results.children.length) clearResults();
  });
})();
