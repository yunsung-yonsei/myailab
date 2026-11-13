// 화면(frontend/*.js) 시나리오 시험. 실제 브라우저 대신 가짜 화면·가짜 네이버 지도·가짜 서버 응답으로
// 페이지와 같은 순서로 스크립트를 불러와 주요 흐름을 확인한다.
// 실행 (medinavi 폴더에서):  node tests/js/frontend.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..", "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const html = read("frontend/index.html");
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const scripts = [...html.matchAll(/<script src="\/static\/([^"?]+)/g)].map(match => "frontend/" + match[1]);
const hospitalsRaw = JSON.parse(read("data/hospitals.json").replace(/^﻿/, ""));
const rules = JSON.parse(read("data/recommendation_rules.json"));
const ILLNESS = ["[재관류중재술] 심근경색", "[재관류중재술] 뇌경색", "[뇌출혈수술] 거미막하출혈", "[뇌출혈수술] 거미막하출혈 외", "[대동맥응급] 흉부",
  "[대동맥응급] 복부", "[담낭담관질환] 담낭질환", "[담낭담관질환] 담도포함질환", "[복부응급수술] 비외상", "[장중첩/폐색] 영유아", "[응급내시경] 성인 위장관",
  "[응급내시경] 영유아 위장관", "[응급내시경] 성인 기관지", "[응급내시경] 영유아 기관지", "[저체중출생아] 집중치료", "[산부인과응급] 분만", "[산부인과응급] 산과수술",
  "[산부인과응급] 부인과수술", "[중증화상] 전문치료", "[사지접합] 수족지접합", "[사지접합] 수족지접합 외", "[응급투석] HD", "[응급투석] CRRT",
  "[정신과적응급] 폐쇄병동입원", "[안과적수술] 응급", "[영상의학혈관중재] 성인", "[영상의학혈관중재] 영유아"];

// 서버가 보내는 것과 같은 모양의 병원 목록 (진료과목 이름 묶기 포함)
function hospitalsResponse() {
  const data = JSON.parse(JSON.stringify(hospitalsRaw));
  for (const item of data.items) {
    if (item.departments) item.departments = [...new Set(item.departments.map(name => name === "구강안면외과" ? "구강악안면외과" : name))];
  }
  data.illness_types = ILLNESS;
  return data;
}

// 병원 순서(index)에 따라 정해지는 가짜 실시간 정보: 혼잡도·중증질환 상태가 골고루 나오게 한다.
function realtimeResponse(items, {minutesAgo = 4} = {}) {
  const updated = new Date(Date.now() - minutesAgo * 60000).toISOString();
  const combos = [[15, 20], [6, 20], [2, 20], [0, 20], [-5, 20], [5, null]];
  const hospitals = {};
  items.forEach((item, index) => {
    if (index === 2) return;                          // 실시간 정보를 주지 않는 기관
    const [available, total] = combos[index % 6];
    const illness = ILLNESS.map(label => ({label, status: "확인 필요", note: ""}));
    illness[0].status = ["가능", "불가", "확인 필요"][index % 3];          // 심근경색
    illness[15].status = "가능";                                           // 분만
    hospitals[item.hpid] = {
      updated_at: updated, has_beds: true, has_illness: index !== 5, er_available: available, er_total: total,
      beds: [{label: "응급실 일반", available, total}, {label: "수술실", available: 3, total: null}],
      equipment: [{label: "CT", status: "가능"}, {label: "혈관촬영기", status: index % 2 ? "불가" : "가능"}],
      illness: index === 5 ? [] : illness,
    };
  });
  // 심근경색 '가능' 병원에는 관련 공지 1건과 이미 끝난 공지 1건을 붙인다.
  const notices = {};
  items.forEach((item, index) => {
    if (index === 2 || index % 3) return;
    notices[item.hpid] = [
      {kind: "중증질환", topic: "심근경색의 재관류중재술", department: "", illness: ILLNESS[0], text: "심장내과 사정으로 CAG 불가능",
       start: updated, end: new Date(Date.now() + 3600000).toISOString()},
      {kind: "응급실", topic: "응급실", department: "", illness: null, text: "끝난 공지", start: updated, end: new Date(Date.now() - 60000).toISOString()},
    ];
  });
  return {retrieved_at: updated, source: "시험", errors: [], hospitals, notices};
}

function createPage({symptom = null, realtimeFails = false, geocode = null} = {}) {
  const els = {};
  const docListeners = {};
  const markers = [];
  const fits = [];
  const routeRequests = [];
  const geoRequests = [];
  const symptomRequests = [];

  function element(id) {
    return {
      id, children: [], options: [], hidden: false, disabled: false, textContent: "", value: "", checked: false, open: false,
      dataset: {}, attrs: {}, style: {}, className: "", listeners: {}, onclick: null,
      classList: {set: new Set(), toggle(name, on) { on ? this.set.add(name) : this.set.delete(name); }, remove(name) { this.set.delete(name); }, contains(name) { return this.set.has(name); }},
      get valueAsNumber() { return Number(this.value); },
      add(option) { this.options.push(option); },
      append(...items) { for (const item of items) typeof item === "string" ? (this.textContent += item) : this.children.push(item); },
      replaceChildren() { this.children = []; if (this.options) this.options = this.options.slice(0, 1); },
      setAttribute(name, value) { this.attrs[name] = value; },
      getAttribute(name) { return this.attrs[name]; },
      addEventListener(type, listener) { (this.listeners[type] = this.listeners[type] || []).push(listener); },
      scrollIntoView() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
      click() { return this.fire("click"); },
      async fire(type) {
        if (type === "click" && this.onclick) await this.onclick();
        for (const listener of this.listeners[type] || []) await listener({preventDefault() {}});
      },
    };
  }
  for (const id of ids) els[id] = element(id);
  // 선택 칸은 첫 선택지(빈 값)를 가진 상태로 시작한다.
  for (const id of ["hospital-type", "department", "illness", "rec-type"]) els[id].options = [{value: ""}];
  els["search-button"].disabled = true;
  const badges = [element("badge1"), element("badge2"), element("badge3")];
  const buttonsIn = id => els[id].children.map(item => item.children[0]);

  const document = {
    querySelector: selector => selector.startsWith("#") ? els[selector.slice(1)] || null : null,
    querySelectorAll(selector) {
      if (selector === "nav button") return [els.all, els.plus, els.minus];
      if (selector === ".rules-badge") return badges;
      if (selector.includes("button[data-hpid]")) return [...buttonsIn("search-results"), ...buttonsIn("recommend-results")];
      throw new Error("시험 화면이 모르는 선택자: " + selector);
    },
    createElement: element,
    addEventListener(type, listener) { (docListeners[type] = docListeners[type] || []).push(listener); },
    dispatchEvent(event) { (docListeners[event.type] || []).forEach(listener => listener(event)); },
    visibilityState: "visible",
  };

  class LatLng { constructor(lat, lng) { this.lat = lat; this.lng = lng; } }
  class Bounds { constructor() { this.points = []; } extend(point) { this.points.push(point); } }
  class Marker {
    constructor(options) { Object.assign(this, options); this.icon = options.icon || "DEFAULT"; markers.push(this); }
    setIcon(icon) { this.icon = icon; } getIcon() { return this.icon; } setMap(map) { this.map = map; } setZIndex(z) { this.z = z; }
    getPosition() { return this.position; } setPosition(position) { this.position = position; } setTitle(title) { this.title = title; }
  }
  const naver = {maps: {
    Map: class { constructor() { this.zoom = 8; } fitBounds(bounds) { fits.push(bounds.points.length); } setCenter() {} setZoom(zoom) { this.zoom = zoom; } getZoom() { return this.zoom; } },
    LatLng, LatLngBounds: Bounds, Marker, Size: class { constructor(w, h) { this.w = w; this.h = h; } }, Point: class {},
    Polyline: class { constructor(options) { this.map = options.map; } setMap(map) { this.map = map; } },
    Event: {listeners: new Map(), addListener(marker, type, listener) { this.listeners.set(marker, listener); }},
  }};

  const hospitals = hospitalsResponse();
  const realtime = realtimeResponse(hospitals.items);
  const ok = body => ({ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body))});
  async function fetch(url, options) {
    if (url === "/api/hospitals") return ok(hospitals);
    if (url === "/api/rules") return ok(rules);
    if (url === "/api/realtime") return realtimeFails ? {ok: false, status: 503, json: async () => ({detail: "실시간 병상 정보가 아직 설정되지 않았어요."})} : ok(realtime);
    if (url === "/api/symptom/parse") {
      const sent = JSON.parse(options.body);
      symptomRequests.push(sent);
      const answer = typeof symptom === "function" ? symptom(sent) : symptom;
      return answer ? ok(answer) : {ok: false, status: 503, json: async () => ({detail: "자연어 검색이 아직 설정되지 않았어요."})};
    }
    if (url.startsWith("/api/geocode")) return ok({results: geocode || []});
    if (url.startsWith("/api/route")) {
      const params = new URLSearchParams(url.split("?")[1]);
      routeRequests.push(params);
      const index = hospitals.items.findIndex(item => item.hpid === params.get("hospital_id"));
      return ok({duration_ms: (5 + index * 3) * 60000, distance_m: (index + 1) * 2500, path: [[128.9, 37.75], [128.8, 37.7]]});
    }
    throw new Error("시험이 모르는 요청: " + url);
  }

  const context = {
    document, naver, fetch, console, URLSearchParams, AbortController, Event, CustomEvent: class extends Event { constructor(type, init) { super(type); this.detail = init?.detail; } },
    Option: function (text, value) { this.text = text; this.value = value; }, MutationObserver: class { observe() {} disconnect() {} },
    navigator: {geolocation: {getCurrentPosition(success, failure) { geoRequests.push({success, failure}); }}},
    isSecureContext: true, setTimeout, clearTimeout, setInterval: () => 0, Date, Math, JSON, Promise,
  };
  context.window = context;
  vm.createContext(context);
  for (const file of scripts) vm.runInContext(read(file), context, {filename: file});
  return {els, context, markers, fits, routeRequests, geoRequests, symptomRequests, hospitals, realtime, badges, buttonsIn, naver,
    run: code => vm.runInContext(code, context)};
}

// 페이지처럼 지도를 띄우고, 지도가 준비되면 자동으로 요청되는 현재 위치에 응답한다.
async function start(page) {
  await page.run("showMap()");
  await new Promise(resolve => setTimeout(resolve, 5));
  if (!page.geoRequests.length) await page.els["my-location"].fire("click");
  const latest = page.geoRequests.pop();
  page.geoRequests.length = 0;
  latest.success({coords: {latitude: 37.75, longitude: 128.9}});
  await new Promise(resolve => setTimeout(resolve, 5));
}
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
const lines = page => page.buttonsIn("search-results").map(button => button.textContent);
const tests = [];
const test = (name, body) => tests.push({name, body});

// ---------------------------------------------------------------------------
test("페이지 스크립트 순서: 공통 판정이 map.js보다 먼저", () => {
  assert.ok(scripts.indexOf("frontend/judgement.js") < scripts.indexOf("frontend/map.js"));
  assert.ok(scripts.every(file => fs.existsSync(path.join(ROOT, file))), "없는 스크립트를 불러와요");
  assert.strictEqual(new Set(ids).size, ids.length, "화면 요소 id가 겹쳐요");
});

test("조건 검색: 진료과목 일치만 결과, 확인 필요는 이동시간과 함께", async () => {
  const page = await (async () => { const p = createPage(); await start(p); return p; })();
  const {els, hospitals} = page;
  els["hospital-type"].value = "지역응급의료기관"; els.department.value = "소아청소년과"; els["max-minutes"].value = "300";
  await els["hospital-search"].fire("submit");
  const results = page.buttonsIn("search-results");
  assert.ok(results.length > 0 && results.length <= 5);
  for (const button of results) {
    const hospital = hospitals.items.find(item => item.hpid === button.dataset.hpid);
    assert.ok(hospital.departments.includes("소아청소년과"));
    assert.match(button.textContent, /\(지역응급의료기관\)/);
    assert.match(button.textContent, /조건: 소아청소년과 일치\(등록\)/);
  }
  assert.match(els["search-status"].textContent, /소아청소년과 불일치 \d+곳/);
  assert.match(els["search-status"].textContent, /일반 자동차 기준 참고값/);
  const unknown = els["search-dept-unknown-list"].children.map(item => item.textContent);
  assert.ok(unknown.length > 0 && unknown.every(text => /약 \d+분 — 소아청소년과 확인 필요\(진료과목 자료 없음\)/.test(text)));
});

test("조건 검색: 중증질환 불일치는 제외, 결과에 '병원 입력' 표시, 결과 없으면 단계 설명", async () => {
  const page = createPage(); await start(page);
  const {els} = page;
  els["hospital-type"].value = "지역응급의료기관"; els.illness.value = "[재관류중재술] 심근경색"; els["max-minutes"].value = "300";
  await els["hospital-search"].fire("submit");
  assert.ok(lines(page).every(text => text.includes("[재관류중재술] 심근경색 일치(가능 · 병원 입력")));
  assert.match(els["search-status"].textContent, /심근경색 불일치 \d+곳/);
  els["max-minutes"].value = "1";
  await els["hospital-search"].fire("submit");
  assert.strictEqual(lines(page).length, 0);
  assert.match(els["search-status"].textContent, /\[지역응급의료기관 \d+곳 → 조건 일치 \d+곳 → 1분 이내 0곳/);
});

test("병원 공지: 목록에 한 줄, 관련 조건 근거에 덧붙임, 끝난 공지는 숨김, 상세에 기간", async () => {
  const page = createPage(); await start(page);
  const {els} = page;
  els["hospital-type"].value = "지역응급의료기관"; els.illness.value = "[재관류중재술] 심근경색"; els["max-minutes"].value = "300";
  await els["hospital-search"].fire("submit");
  const results = lines(page);
  assert.ok(results.length > 0);
  for (const text of results) {
    assert.match(text, /심근경색 일치\(가능 · 병원 입력 · ⚠ 공지: 심장내과 사정으로 CAG 불가능\)/);
    assert.match(text, /\n⚠ 병원 공지: 심장내과 사정으로 CAG 불가능$/, "끝난 공지는 세지 않아야 해요");
  }
  const hospital = page.hospitals.items[0];
  page.run(`window.medinaviRealtime.renderDetail(${JSON.stringify(hospital)})`);
  const body = els["realtime-body"].children;
  assert.match(body[0].textContent, /병원 공지 \(병원이 직접 올린 내용 · 1건\)/);
  const item = body[1].children[0];
  assert.strictEqual(item.children[0].textContent, "[[재관류중재술] 심근경색] ");
  assert.match(item.textContent, /CAG 불가능 · \d+\/\d+\(.\) \d\d:\d\d까지/);
});

test("실시간: 가용/전체와 혼잡도 색, 포화·대기", async () => {
  const page = createPage(); await start(page);
  const summary = hpid => page.run(`window.medinaviRealtime.summary(${JSON.stringify(hpid)})`);
  const level = hpid => page.run(`window.medinaviRealtime.level(${JSON.stringify(hpid)})`);
  const items = page.hospitals.items;
  assert.match(summary(items[0].hpid), /^응급실 15\/20 \(원활\) · \d+분 전$/);
  assert.strictEqual(level(items[1].hpid), "보통");
  assert.strictEqual(level(items[3].hpid), "포화");
  assert.match(summary(items[4].hpid), /-5\/20 \(포화 · 대기 5\)/);
  assert.strictEqual(summary(items[2].hpid), "응급실 실시간 정보 없음");
});

test("증상 추천: 흉통 → 확인창 → 심근경색 일치 병원만 1~5순위, 근거 표시", async () => {
  const page = createPage({symptom: {category_id: "cardiac", symptom_keywords: ["가슴 통증"], is_child: false, max_minutes: 300}});
  await start(page);
  const {els} = page;
  els["symptom-query"].value = "70대 남성 가슴 통증";
  await els["symptom-search"].listeners.submit[0]({preventDefault() {}});
  assert.ok(els["symptom-confirm"].open);
  assert.strictEqual(els["confirm-category"].value, "cardiac");
  assert.match(page.badges[0].textContent, /임시 분류표 · 자문 전 · Pre-KTAS/);
  for (const listener of els["symptom-go"].listeners.click) await listener();
  await tick();
  const results = page.buttonsIn("recommend-results");
  assert.ok(results.length > 0 && results.length <= 5);
  const statusOf = hpid => page.realtime.hospitals[hpid]?.illness?.[0]?.status;
  assert.ok(results.every(button => statusOf(button.dataset.hpid) === "가능"));
  assert.match(results[0].textContent, /조건: \[재관류중재술\] 심근경색 일치/);
  assert.match(els["recommend-status"].textContent, /조건 불일치 \d+곳 제외/);
  // 1순위를 누르면 상세가 열리고 목록에서도 강조된다.
  await results[0].fire("click");
  assert.strictEqual(els["hospital-detail"].hidden, false);
  assert.strictEqual(results[0].attrs["aria-current"], "true");
});

test("증상 추천: AI 실패 시 직접 분류, 확인 필요가 많으면 접기, 조건 검색과 서로 정리", async () => {
  const page = createPage(); await start(page);
  const {els} = page;
  els["symptom-query"].value = "손가락 절단";
  await els["symptom-search"].listeners.submit[0]({preventDefault() {}});
  assert.ok(els["symptom-confirm"].open);
  assert.strictEqual(els["confirm-category"].value, "unclear");
  assert.match(els["symptom-note"].textContent, /직접 골라 주세요/);
  els["confirm-category"].value = "amputation";
  els["rec-minutes"].value = "300";
  for (const listener of els["symptom-go"].listeners.click) await listener();
  await tick();
  assert.strictEqual(els["recommend-results"].children.length, 0);
  assert.ok(els["recommend-unknown-list"].children.length > 5 && els["recommend-unknown"].open === false);
  assert.match(els["recommend-status"].textContent, /\[후보 \d+곳 → 조건 일치 0곳/);
  // 조건 검색을 하면 추천 결과가 정리된다.
  els["hospital-type"].value = "지역응급의료기관"; els["max-minutes"].value = "300";
  await els["hospital-search"].fire("submit");
  assert.strictEqual(els["recommend-area"].hidden, true);
});

test("조건 바꾸기: 직전 조건을 함께 보내고, 바뀐 항목을 알려주고, 다시 찾기", async () => {
  const adult = {category_id: "cardiac", symptom_keywords: ["가슴 통증"], is_child: false, max_minutes: 300};
  const page = createPage({symptom: sent => sent.previous ? {...adult, symptom_keywords: [], is_child: true} : adult});
  await start(page);
  const {els} = page;
  assert.ok(els["refine-form"].hidden, "검색 전에는 조건 바꾸기를 숨겨요");
  els["symptom-query"].value = "가슴 통증";
  await els["symptom-search"].listeners.submit[0]({preventDefault() {}});
  els["rec-type"].value = "지역응급의료기관";
  for (const listener of els["symptom-go"].listeners.click) await listener();
  await tick();
  assert.ok(!els["refine-form"].hidden);
  assert.strictEqual(els["refine-current"].textContent, "현재 조건: 흉통 · 심혈관 의심 · 소아 아님 · 300분 이내 · 지역응급의료기관");

  els["refine-query"].value = "7살 아이예요";
  await els["refine-form"].listeners.submit[0]({preventDefault() {}});
  const sent = page.symptomRequests.at(-1);
  assert.deepStrictEqual(sent, {query: "7살 아이예요", previous: {query: "가슴 통증", category_id: "cardiac", is_child: false, max_minutes: 300}});
  assert.ok(els["symptom-confirm"].open, "바뀐 조건은 확인창에서 다시 확인해요");
  assert.strictEqual(els["symptom-note"].textContent, "바뀐 항목: 소아 아니오 → 예");
  assert.strictEqual(els["rec-type"].value, "지역응급의료기관", "언급 안 한 유형은 그대로");
  assert.strictEqual(els["refine-query"].value, "");
  for (const listener of els["symptom-go"].listeners.click) await listener();
  await tick();
  assert.match(els["refine-current"].textContent, /· 소아 ·/);

  // 다음 조건 바꾸기 때는 문장이 이어 붙어 전체 맥락이 간다.
  els["refine-query"].value = "30분 안으로";
  await els["refine-form"].listeners.submit[0]({preventDefault() {}});
  assert.strictEqual(page.symptomRequests.at(-1).previous.query, "가슴 통증 / 7살 아이예요");
});

test("병원 상세: 추가 확인 사항에 전화 확인, 검색 조건 확인 필요, 공지, 이동시간 한계", async () => {
  const page = createPage(); await start(page);
  const {els} = page;
  els["hospital-type"].value = "지역응급의료기관"; els.illness.value = "[재관류중재술] 심근경색"; els["max-minutes"].value = "300";
  await els["hospital-search"].fire("submit");
  const items = page.hospitals.items;
  // 심근경색 '확인 필요'인 지역응급의료기관 하나를 고른다 (index % 3 === 2, 실시간 있음)
  const unsure = items.find((item, index) => index % 3 === 2 && index % 6 !== 5 && index !== 2 && item.dutyEmclsName === "지역응급의료기관");
  page.run(`showHospitalDetail(${JSON.stringify(unsure)}, window.medinaviData)`);
  const texts = els["detail-checks-list"].children.map(item => item.textContent);
  assert.match(texts[0], /출발 전에 응급실\(.+\)에 전화로 확인/);
  assert.ok(texts.some(text => /검색 조건 '\[재관류중재술\] 심근경색': .*확인 필요/.test(text)), texts.join("\n"));
  assert.ok(texts.some(text => /병원이 입력한 값이고 갱신 시각이 제공되지 않아요/.test(text)));
  assert.match(texts.at(-1), /일반 자동차 기준 참고값/);

  const withNotice = items[0];
  page.run(`showHospitalDetail(${JSON.stringify(withNotice)}, window.medinaviData)`);
  assert.ok(els["detail-checks-list"].children.some(item => /공지가 1건/.test(item.textContent)));
});

test("출발지 주소: 고른 주소로 길찾기, 버튼 이름 변경, 늦게 온 위치 응답 무시", async () => {
  const page = createPage({geocode: [{road_address: "강원특별자치도 원주시 시청로 1", jibun_address: "무실동 1", latitude: 37.3422, longitude: 127.9202}]});
  await start(page);
  const {els} = page;
  assert.strictEqual(els["search-button"].textContent, "내 위치 기준으로 검색");
  await els["my-location"].fire("click");
  const pending = page.geoRequests.shift();
  els["origin-query"].value = "원주시 시청로 1";
  await els["origin-search"].listeners.submit[0]({preventDefault() {}});
  await els["origin-results"].children[0].children[0].onclick();
  pending.success({coords: {latitude: 1, longitude: 1}});               // 늦게 온 위치 응답
  assert.strictEqual(els["search-button"].textContent, "출발지(강원특별자치도 원주시 시청로 1) 기준으로 검색");
  els["hospital-type"].value = "지역응급의료기관"; els["max-minutes"].value = "300";
  await els["hospital-search"].fire("submit");
  const last = page.routeRequests[page.routeRequests.length - 1];
  assert.strictEqual(last.get("start_lat"), "37.3422");
});

test("실시간 정보를 못 불러와도 조건 검색은 동작하고 중증질환은 확인 필요로", async () => {
  const page = createPage({realtimeFails: true}); await start(page);
  const {els} = page;
  els["hospital-type"].value = "지역응급의료기관"; els["max-minutes"].value = "300";
  await els["hospital-search"].fire("submit");
  assert.ok(lines(page).length > 0);
  els.illness.value = "[재관류중재술] 심근경색";
  await els["hospital-search"].fire("submit");
  assert.strictEqual(lines(page).length, 0);
  assert.ok(els["search-ill-unknown-list"].children.every(item => item.textContent.includes("실시간 정보를 불러오지 못함")));
});

// ---------------------------------------------------------------------------
(async () => {
  let failed = 0;
  for (const {name, body} of tests) {
    try {
      await body();
      console.log("ok   " + name);
    } catch (error) {
      failed += 1;
      console.log("FAIL " + name + "\n     " + (error.stack || error).toString().split("\n").slice(0, 3).join("\n     "));
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} 통과`);
  process.exit(failed ? 1 : 0);
})();
