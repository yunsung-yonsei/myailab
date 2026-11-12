// 팀장님 map.js의 데이터 조회·상세정보 기능에 지도 표시만 추가한다.
// API를 새로 호출하지 않고 기존 거리 조회 결과의 path를 함께 사용한다.
window.hospitalRouteView = (() => {
  let map = null;                 // 팀장님 코드에서 만든 네이버 지도
  let selectedHospital = null;    // 사용자가 현재 선택한 병원
  let locationMarker = null;      // 내 위치를 표시하는 기존 빨간 점
  let routeLine = null;           // 지도 위에 그린 자동차 이동 경로
  let routeLabel = null;          // 경로 옆의 예상 시간·거리 상자
  const hospitals = new Map();    // 기관 ID별 병원 핀과 원래 모양
  let searchResults = [];         // 추가: 조건 검색 결과 [{hospital, route}] (예상 이동시간순)

  // 앞서 사용한 흰 원이 있는 물방울 모양. 가로·세로를 약 두 배로 표시한다.
  function selectedIcon() {
    return {
      content: '<svg width="44" height="60" viewBox="0 0 22 30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path d="M11 29C8 24 1 17 1 11a10 10 0 0 1 20 0c0 6-7 13-10 18Z" fill="#147d52" stroke="white"/>' +
        '<circle cx="11" cy="11" r="4" fill="white"/></svg>',
      size: new naver.maps.Size(44, 60),
      anchor: new naver.maps.Point(22, 60)
    };
  }

  // 추가: 검색 결과 순번(1~5)을 적은 핀. 선택하면 초록색으로 약 1.5배 커진다.
  function numberedIcon(rank, selected) {
    const [width, height] = selected ? [44, 60] : [30, 41];
    const color = selected ? "#147d52" : "#126c60";
    return {
      content: '<svg width="' + width + '" height="' + height + '" viewBox="0 0 22 30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path d="M11 29C8 24 1 17 1 11a10 10 0 0 1 20 0c0 6-7 13-10 18Z" fill="' + color + '" stroke="white"/>' +
        '<text x="11" y="15" text-anchor="middle" font-size="11" font-weight="700" fill="white" font-family="system-ui,sans-serif">' + rank + '</text></svg>',
      size: new naver.maps.Size(width, height),
      anchor: new naver.maps.Point(width / 2, height)
    };
  }

  function searchRank(id) {
    const index = searchResults.findIndex(({hospital}) => hospital.hpid === id);
    return index === -1 ? 0 : index + 1;
  }

  function clearRoute() {
    if (routeLine) routeLine.setMap(null);
    if (routeLabel) routeLabel.setMap(null);
    routeLine = null;
    routeLabel = null;
  }

  function updateMarkers() {
    const selectedId = selectedHospital?.hpid;
    const searching = searchResults.length > 0;
    const showOnlySelected = !searching && Boolean(currentLocation && hospitals.has(selectedId));
    for (const [id, hospital] of hospitals) {
      const selected = id === selectedId;
      const rank = searchRank(id);
      if (searching) {
        // 추가: 검색 중에는 결과 병원만 번호 핀으로 표시하고, 선택한 병원은 크게 강조한다.
        hospital.marker.setIcon(rank ? numberedIcon(rank, selected) : hospital.originalIcon);
        hospital.marker.setZIndex(selected ? 500 : 100 - rank);
        hospital.marker.setMap(rank ? map : null);
        continue;
      }
      hospital.marker.setIcon(selected ? selectedIcon() : hospital.originalIcon);
      hospital.marker.setZIndex(selected ? 500 : 1);
      hospital.marker.setMap(showOnlySelected && !selected ? null : map);
    }
    // 추가: 목록(조건 검색·증상 추천)에서도 같은 병원을 강조한다.
    document.querySelectorAll("#search-results button[data-hpid], #recommend-results button[data-hpid]").forEach(button => {
      button.setAttribute("aria-current", String(button.dataset.hpid === selectedId));
    });
    // 출발지를 알 수 있도록 빨간 현재 위치 점은 병원 선택 후에도 유지한다.
    if (locationMarker) {
      locationMarker.setMap(currentLocation ? map : null);
    }
    const totalCount = document.querySelector("#hospital-list").children.length;
    statusText.textContent = "조회 기관 " + totalCount + "곳 · " +
      (searching ? "지도에 검색 결과 " + searchResults.length + "곳 표시"
        : showOnlySelected ? "지도에 선택 병원 1곳 표시" : "지도에 표시 " + hospitals.size + "곳");
    if (showOnlySelected) {
      document.querySelector("#my-location-status").textContent = currentLocation.label
        ? "지정한 출발지(" + currentLocation.label + ")를 사용해요."
        : "확인한 내 위치를 출발지로 사용해요.";
    }
  }

  function register(hospitalMap, hospital, marker) {
    map = hospitalMap;
    hospitals.set(hospital.hpid, { marker, originalIcon: marker.getIcon() });
  }

  function select(hospital) {
    clearRoute();
    selectedHospital = hospital;
    updateMarkers();
  }

  function showRouteLabel(path, result) {
    // 거리와 시간은 도로 경로 API의 원래 값을 사용한다.
    const minutes = Math.ceil(result.duration_ms / 60000);
    const distanceKm = (result.distance_m / 1000).toFixed(1);
    const label = document.createElement("div");
    label.className = "route-summary-label";
    label.title = "일반 자동차 기준의 예상 시간과 전체 이동거리";
    label.style.cssText = "width:88px;padding:8px;background:#171717;color:#fff;" +
      "border-radius:8px;text-align:center;font:600 14px/1.5 system-ui,sans-serif;" +
      "box-shadow:0 2px 6px #0003;pointer-events:none;";
    const timeLine = document.createElement("div");
    const distanceLine = document.createElement("div");
    timeLine.textContent = "약 " + minutes + "분";
    distanceLine.textContent = distanceKm + "km";
    label.append(timeLine, distanceLine);
    // 경로 중간 좌표 옆에 붙여 확대·축소하거나 지도를 옮겨도 경로를 따라간다.
    routeLabel = new naver.maps.Marker({
      map, position: path[Math.floor(path.length / 2)], zIndex: 300, clickable: false,
      icon: { content: label, size: new naver.maps.Size(88, 58), anchor: new naver.maps.Point(-12, 29) }
    });
  }

  function draw(hospital, result) {
    // 원본의 요청 취소 처리에 더해 현재 선택한 병원인지도 확인한다.
    if (!currentLocation || hospital.hpid !== selectedHospital?.hpid) return;
    const destination = hospitals.get(hospital.hpid);
    if (!destination) return;
    if (!Array.isArray(result.path) || result.path.length < 2 ||
        !result.path.every(point => Array.isArray(point) &&
          Number.isFinite(point[0]) && Math.abs(point[0]) <= 180 &&
          Number.isFinite(point[1]) && Math.abs(point[1]) <= 90)) {
      throw new Error("도로 경로 좌표를 받지 못했어요.");
    }
    clearRoute();
    // API 응답은 [경도, 위도], 지도 생성자는 (위도, 경도) 순서다.
    const path = result.path.map(point => new naver.maps.LatLng(point[1], point[0]));
    routeLine = new naver.maps.Polyline({
      map, path, strokeColor: "#147d52", strokeWeight: 6, strokeOpacity: 0.9
    });
    showRouteLabel(path, result);
    updateMarkers();
    const bounds = new naver.maps.LatLngBounds();
    path.forEach(position => bounds.extend(position));
    bounds.extend(new naver.maps.LatLng(currentLocation.latitude, currentLocation.longitude));
    bounds.extend(destination.marker.getPosition());
    // 오른쪽 여백에 경로 정보 상자가 들어갈 공간을 확보한다.
    map.fitBounds(bounds, { top: 70, right: 110, bottom: 75, left: 35 });
  }

  // 추가: 현재 위치와 검색 결과 병원이 한 화면에 들어오도록 지도 범위를 맞춘다.
  function fitSearchResults() {
    const bounds = new naver.maps.LatLngBounds();
    let count = 0;
    for (const {hospital} of searchResults) {
      const pin = hospitals.get(hospital.hpid);
      if (pin) { bounds.extend(pin.marker.getPosition()); count++; }
    }
    if (!count) return;
    if (currentLocation) bounds.extend(new naver.maps.LatLng(currentLocation.latitude, currentLocation.longitude));
    map.fitBounds(bounds, { top: 60, right: 40, bottom: 40, left: 40 });
  }

  // 추가: 검색 결과(예상 이동시간순, 최대 5곳)를 지도에 번호 핀으로 표시한다.
  function showSearchResults(results) {
    routeRequest?.abort();
    clearRoute();
    selectedHospital = null;
    searchResults = results.filter(({hospital}) => hospitals.has(hospital.hpid));
    updateMarkers();
    fitSearchResults();
  }

  // 추가: 새 검색·조건 변경·내 위치 재조회 시 이전 핀, 경로, 상세정보를 정리한다.
  function clearSearch() {
    if (!searchResults.length) return;
    routeRequest?.abort();
    searchResults = [];
    selectedHospital = null;
    clearRoute();
    document.querySelector("#hospital-detail").hidden = true;
    routeInfo.textContent = "";
    updateMarkers();
  }

  // 추가: 지도 핀을 눌렀을 때 검색에서 받은 경로를 다시 쓰도록 꺼내 준다.
  function routeFor(id) {
    return searchResults.find(({hospital}) => hospital.hpid === id)?.route || null;
  }

  function locationReset() {
    clearRoute();
    updateMarkers();
  }

  function locationReady(marker) {
    locationMarker = marker;
    updateMarkers();
    if (selectedHospital) showHospitalRoute(selectedHospital);
  }

  function showAll() {
    // 진행 중인 응답이 도착해 전체 보기를 다시 경로 보기로 바꾸지 않게 한다.
    routeRequest?.abort();
    selectedHospital = null;
    clearRoute();
    updateMarkers();
    // 추가: 검색 중이면 전체 병원 대신 현재 위치와 검색 결과 전체가 보이게 한다.
    if (searchResults.length) fitSearchResults();
  }

  return { register, select, draw, locationReset, locationReady, showAll,
           showSearchResults, clearSearch, routeFor };
})();

// 페이지 방문마다 한 번만 현재 위치를 요청한다.
// 권한 허용 여부는 브라우저가 관리하고, 실패하면 기존 '내 위치' 버튼으로 재시도한다.
(() => {
  const locationButton = document.querySelector("#my-location");
  let locationRequested = false;
  const readyObserver = new MutationObserver(requestInitialLocation);

  function requestInitialLocation() {
    if (locationButton.disabled || locationRequested) return;
    readyObserver.disconnect();
    // 팀장님 코드의 위치 조회·권한 오류 안내를 그대로 재사용한다.
    locationButton.click();
  }

  locationButton.addEventListener("click", () => {
    locationRequested = true;
    readyObserver.disconnect();
  }, { once: true, capture: true });

  // 병원 데이터와 지도가 준비되어 버튼이 활성화될 때 실행한다.
  // 고정 시간 타이머 대신 실제 준비 상태를 확인하므로 느린 연결에서도 동작한다.
  readyObserver.observe(locationButton, { attributes: true, attributeFilter: ["disabled"] });
  requestInitialLocation();
})();
