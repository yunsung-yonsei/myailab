const statusText = document.querySelector("#status");
function mapError() {
  statusText.textContent = "지도를 불러오지 못했어요. 인터넷 연결과 네이버 지도에 등록된 웹 주소를 확인해 주세요.";
}
window.navermap_authFailure = mapError;

const routeInfo = document.querySelector("#route-info");
let currentLocation = null;
let routeRequest = null;

async function fetchRoute(url, signal) {
  const options = {signal, cache: "no-store"};
  try {
    return await fetch(url, options);
  } catch (error) {
    if (signal.aborted || !(error instanceof TypeError)) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (signal.aborted) {
      throw error;
    }
    return fetch(url, options);
  }
}

async function showHospitalRoute(hospital) {
  // 병원을 바꾸면 이전 요청의 결과가 화면에 표시되지 않도록 한다.
  routeRequest?.abort();
  if (!currentLocation) {
    routeInfo.textContent = "'내 위치'를 눌러 이동거리를 확인하세요.";
    return;
  }
  if (!hospital.hpid) {
    routeInfo.textContent = "의료기관 ID를 확인할 수 없어요.";
    return;
  }
  const controller = new AbortController();
  routeRequest = controller;
  routeInfo.textContent = "이동거리와 시간을 조회하고 있어요.";
  const params = new URLSearchParams({
    hospital_id: hospital.hpid,
    start_lat: currentLocation.latitude,
    start_lon: currentLocation.longitude,
  });
  let httpStatus = null;
  try {
    const response = await fetchRoute(`/api/route?${params}`, controller.signal); 
    httpStatus = response.status;
    const result = await response.json().catch(() => null);
    if (controller.signal.aborted) return;
    if (!response.ok) {
      const detail = typeof result?.detail === "string"? result.detail: "서버에서 이동정보를 받지 못했어요.";
      routeInfo.textContent = `이동정보 조회 실패 (HTTP ${response.status}) · ${detail}`;
      return;
    }
    if (!result || typeof result !== "object"){
      routeInfo.textContent = "서버 응답을 읽지 못했어요. 페이지를 새로고침해 주세요.";
      return;
    }
    const {distance_m, duration_ms} = result;
    if (!Number.isFinite(distance_m) || distance_m < 0 || !Number.isFinite(duration_ms) || duration_ms < 0
  ) {
    throw new Error("거리 또는 시간 정보가 올바르지 않습니다.");
  }
  // 추가: 이미 조회한 도로 좌표로 경로를 자동 표시한다.
  window.hospitalRouteView?.draw(hospital, result);
  const distanceKm = (distance_m / 1000).toFixed(1);
  const minutes = Math.ceil(duration_ms / 60000);
  routeInfo.textContent = `내 위치 기준 · 자동차 이동거리 ${distanceKm}km · 예상 ${minutes}분`;
  } catch (error) {
    if (!controller.signal.aborted) {
      routeInfo.textContent = httpStatus === null ? `이동정보 서버에 연결하지 못했어요. (${error.name})`: `이동정보 응답 처리 오류 (HTTP ${httpStatus}) · ${error.message}`;
      console.error(error);
    }
  } finally {
    if (routeRequest === controller) {
      routeRequest = null;
    }
  }
}

// 핀과 목록 버튼이 같은 상세정보 영역을 사용한다.
function showHospitalDetail(hospital, data) {
  // 추가: 선택 병원 강조와 이전 경로 정리.
  window.hospitalRouteView?.select(hospital);
  const detail = document.querySelector("#hospital-detail");
  const fields = document.querySelector("#detail-fields");
  const lookupTime = new Date(data.retrieved_at || "");
  const timeText = Number.isFinite(lookupTime.getTime())
    ? lookupTime.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + " (한국시간)"
    : "";
  // 출처와 조회 시점은 JSON 전체에 공통으로 저장되어 있다.
  const details = [
    ["기관명", hospital.dutyName],
    ["응급의료기관 유형", hospital.dutyEmclsName],
    ["주소", hospital.dutyAddr],
    ["응급실 연락처", hospital.dutyTel3],
    ["정보 출처", data.source],
    ["조회 시점", timeText],
  ];
  fields.replaceChildren();
  for (const [label, value] of details) {
    const name = document.createElement("dt");
    const description = document.createElement("dd");
    name.textContent = label;
    description.textContent = String(value ?? "").trim() || "확인 필요";
    fields.append(name, description);
  }
  detail.hidden = false;
  document.querySelector("#detail-title").focus();
  detail.scrollIntoView({ block: "start" });
  showHospitalRoute(hospital);
}

function setupMyLocation(map) {
  const button = document.querySelector("#my-location");
  const message = document.querySelector("#my-location-status");
  let MyLocationMarker = null;
  button.disabled = false;
  button.addEventListener("click", () => {
    if (!window.isSecureContext) {
      message.textContent = "내 위치를 보려면 HTTPS 주소로 접속해 주세요.";
      return;
    }
    if (!navigator.geolocation) {
      message.textContent = "이 브라우저에서는 위치 기능을 사용할 수 없어요.";
      return;
    }
    button.disabled = true;
    message.textContent = "내 위치를 확인하고 있어요.";
    routeRequest?.abort();
    currentLocation = null;
    // 추가: 출발지 재조회 중에는 이전 경로를 제거한다.
    window.hospitalRouteView?.locationReset();
    routeInfo.textContent = "위치를 확인한 뒤 병원을 선택해 주세요.";
    navigator.geolocation.getCurrentPosition(
      ({coords}) => {
        currentLocation = {
          latitude: coords.latitude, longitude: coords.longitude,
        };
        routeInfo.textContent = "병원을 선택하면 내 위치에서의 이동정볼르 보여줘요.";
        const position = new naver.maps.LatLng(
          coords.latitude, 
          coords.longitude
        );
      if (MyLocationMarker) {
        MyLocationMarker.setPosition(position);
      } else {
        MyLocationMarker = new naver.maps.Marker({
          map, position, title: "내 위치", zIndex: 1000, icon: {
            content: '<span class="my-location-dot" aria-hidden="true"></span>',
            size: new naver.maps.Size(18, 18),
            anchor: new naver.maps.Point(9, 9),
          },
        });
      }
      map.setCenter(position);
      map.setZoom(Math.max(map.getZoom(), 15));
      // 추가: 위치를 나중에 확인한 경우에도 선택 병원의 경로를 조회한다.
      window.hospitalRouteView?.locationReady(MyLocationMarker);
      message.textContent = "지도에 내 위치를 표시했어요.";
      button.disabled = false;
      },
      (error) => {
        routeInfo.textContent = "'내 위치'를 눌러 이동거리를 확인하세요.";
        if (MyLocationMarker) {
          MyLocationMarker.setMap(null);
          MyLocationMarker = null;
        }
        if (error.code === 1) {
          message.textContent = "브라우저의 사이트 설정에서 위치 권한을 허용해 주세요.";
        } else if (error.code === 3){
          message.textContent = "위치 확인 시간이 초과됐어요. 다시 눌러주세요.";
        } else {
          message.textContent = "현재 위치를 가져오지 못했어요.";
        }
        button.disabled = false;
      },
      {timeout: 10000, maximumAge: 0}
    );
  });
}

async function showMap() {
  if (!window.naver?.maps?.Map) return mapError();
  try {
    // 기관 목록을 따로 복사하지 않고 1번에서 저장한 JSON을 읽는다.
    const response = await fetch("/api/hospitals");
    if (!response.ok) throw new Error("기관 파일 없음");
    const data = await response.json();
    const map = new naver.maps.Map("map", {center: new naver.maps.LatLng(37.8, 128.3), zoom: 8});
    const bounds = new naver.maps.LatLngBounds();
    let markerCount = 0;
    const hospitalList = document.querySelector("#hospital-list");
    for (const hospital of data.items) {
      // 모든 기관을 먼저 목록에 넣어 좌표가 빠진 기관도 이름으로 찾을 수 있게 한다.
      const listItem = document.createElement("li");
      const hospitalButton = document.createElement("button");
      hospitalButton.textContent = hospital.dutyName || "기관명 확인 필요";
      hospitalButton.onclick = () => showHospitalDetail(hospital, data);
      listItem.append(hospitalButton);
      hospitalList.append(listItem);

      // 빈 문자열이 숫자 0으로 변환되지 않도록 두 좌표를 먼저 확인한다.
      const latitudeText = String(hospital.wgs84Lat ?? "").trim();
      const longitudeText = String(hospital.wgs84Lon ?? "").trim();
      const latitude = Number(latitudeText);
      const longitude = Number(longitudeText);
      if (!latitudeText || !longitudeText) {
        hospitalButton.append(" · 좌표 없음");
        continue;
      }
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
          !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
        hospitalButton.append(" · 좌표 확인 필요");
        continue;
      }
      const position = new naver.maps.LatLng(latitude, longitude);
      const marker = new naver.maps.Marker({map, position, title: hospital.dutyName});
      // 추가: 원본 병원 핀을 별도 기능 파일에 전달한다.
      window.hospitalRouteView?.register(map, hospital, marker);
      naver.maps.Event.addListener(marker, "click", () => showHospitalDetail(hospital, data));
      bounds.extend(position);
      markerCount++;
    }
    // 실제 기관 좌표에 맞춰 처음 화면과 '전체 보기'의 범위를 정한다.
    function showAll() { if (markerCount) map.fitBounds(bounds, {top:32,right:32,bottom:32,left:32}); }
    showAll();
    setupMyLocation(map);
    document.querySelector("#all").onclick = showAll;
    // 추가: 전체 보기에서는 모든 병원 핀을 다시 표시한다.
    document.querySelector("#all").addEventListener("click", () => window.hospitalRouteView?.showAll());
    document.querySelector("#plus").onclick = () => map.setZoom(map.getZoom()+1);
    document.querySelector("#minus").onclick = () => map.setZoom(map.getZoom()-1);
    document.querySelectorAll("nav button").forEach(button => button.disabled = false);
    statusText.textContent = "조회 기관 " + data.items.length + "곳 · 지도에 표시 " + markerCount + "곳";
  } catch (error) {
    statusText.textContent = "기관 지도를 준비하지 못했어요. 서버와 조회결과 파일을 확인해 주세요.";
    console.error(error);
  }
}
