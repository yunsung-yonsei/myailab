"""서버(app.py) 단위 시험. 네트워크 없이 tests/stubs의 가짜 모듈로 실행한다.

실행 (medinavi 폴더에서):  python -m unittest discover -s tests -p "test_*.py" -v
"""

import asyncio
import importlib.util
import json
import os
import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
APP_PATH = TESTS_DIR.parent / "app.py"
STUB_NAMES = ("fastapi", "httpx", "openai", "pydantic", "dotenv")


def load_app(**env):
    """가짜 모듈을 먼저 찾도록 한 뒤 app.py를 새로 불러온다."""
    sys.path.insert(0, str(TESTS_DIR / "stubs"))
    for name in list(sys.modules):
        if name.split(".")[0] in STUB_NAMES:
            del sys.modules[name]
    for key in ("EMERGENCY_API_KEY", "OPENAI_API_KEY", "NAVER_GEOCODING_CLIENT_ID", "NAVER_GEOCODING_CLIENT_SECRET"):
        os.environ.pop(key, None)
    os.environ.update({"NAVER_MAPS_CLIENT_ID": "map-id", "NAVER_MAPS_CLIENT_SECRET": "map-secret", **env})
    spec = importlib.util.spec_from_file_location("medinavi_app", APP_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, sys.modules["httpx"], sys.modules["openai"]


def run(coroutine):
    return asyncio.run(coroutine)


class FakeRequest:
    def __init__(self, ip="1.1.1.1"):
        self.headers = {}
        self.client = type("Client", (), {"host": ip})()


def nmc_xml(rows):
    body = "".join("<item>" + "".join(f"<{k}>{v}</{k}>" for k, v in row.items()) + "</item>" for row in rows)
    return f"<response><header><resultCode>00</resultCode></header><body><items>{body}</items></body></response>"


class HospitalsAndRules(unittest.TestCase):
    def setUp(self):
        self.app, _, _ = load_app()

    def test_departments_normalized_and_illness_types(self):
        data = self.app.get_hospitals()
        departments = {name for item in data["items"] for name in item.get("departments", [])}
        self.assertIn("구강악안면외과", departments)
        self.assertNotIn("구강안면외과", departments)
        self.assertTrue(all(len(item.get("departments", [])) == len(set(item.get("departments", []))) for item in data["items"]))
        self.assertEqual(len(data["illness_types"]), 27)

    def test_rules_names_match_data(self):
        rules = self.app.get_rules()
        departments = {name for item in self.app.get_hospitals()["items"] for name in item.get("departments", [])}
        names = {"illness": {label for _, label in self.app.ILLNESS_FIELDS}, "equipment": {label for _, label in self.app.FLAG_FIELDS},
                 "bed": {label for _, label in self.app.BED_FIELDS}, "department": departments}
        ids = [category["id"] for category in rules["categories"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn("unclear", ids)
        items = [item for category in rules["categories"] for key in ("required", "required_any", "reference") for item in category.get(key, [])]
        items += rules.get("child_required", []) + rules.get("child_reference", [])
        wrong = [item for item in items if item["name"] not in names[item["type"]]]
        self.assertEqual(wrong, [], "규칙표 이름이 실제 데이터 이름과 달라요")
        self.assertIn("pre_ktas", rules)


class Realtime(unittest.TestCase):
    def setUp(self):
        self.app, self.httpx, _ = load_app(EMERGENCY_API_KEY="abc%2Bdef%3D%3D")
        self.mode = "ok"
        self.messages = {}

        def handler(url, headers, params):
            operation = url.rsplit("/", 1)[1]
            if self.mode == "down" or (self.mode == "beds_down" and operation.startswith("getEmrrm")):
                return 500, "error"
            if operation == "getEmrrmSrsillDissMsgInqire":
                return 200, nmc_xml(self.messages.get(params.get("HPID"), []))
            if params.get("STAGE1") != "강원특별자치도":
                return 200, nmc_xml([])
            if operation == "getEmrrmRltmUsefulSckbdInfoInqire":
                return 200, nmc_xml([{"hpid": "A1", "hvidate": "20261112181316", "hvec": "-10", "hvs01": "23", "hvoc": "7",
                                      "hv29": "2", "hvctayn": "Y", "hvangioayn": "N1"}])
            illness = {"hpid": "A1", **{f"MKioskTy{n}": "정보미제공" for n in range(1, 29)}}
            illness.update(MKioskTy1="Y", MKioskTy2="불가능", MKioskTy3="N1", MKioskTy15="Y", MKioskTy15Msg="1800g 이상")
            return 200, nmc_xml([illness, {"hpid": "A2", "MKioskTy28": "Y"}])
        self.httpx.handler = handler

    def call(self):
        try:
            return run(self.app.app.routes["/api/realtime"](FakeRequest()))
        except self.app.HTTPException as error:
            return error

    def test_normalized_values(self):
        data = self.call()
        hospital = data["hospitals"]["A1"]
        self.assertEqual(hospital["er_available"], -10)
        self.assertEqual(hospital["er_total"], 23)
        self.assertEqual(hospital["updated_at"], "2026-11-12T18:13:16+09:00")
        self.assertIn({"label": "응급실 내 음압격리병상", "available": 2, "total": None}, hospital["beds"])
        self.assertEqual({item["label"]: item["status"] for item in hospital["equipment"]}, {"CT": "가능", "혈관촬영기": "불가"})
        statuses = {item["label"]: item["status"] for item in hospital["illness"]}
        self.assertEqual(statuses["[재관류중재술] 심근경색"], "가능")
        self.assertEqual(statuses["[재관류중재술] 뇌경색"], "불가")
        self.assertEqual(statuses["[뇌출혈수술] 거미막하출혈"], "불가")
        self.assertEqual(statuses["[대동맥응급] 흉부"], "확인 필요")
        self.assertFalse(data["hospitals"]["A2"]["has_beds"])
        self.assertEqual(self.httpx.calls[0][2]["serviceKey"], "abc+def==")   # Encoding 키를 풀어서 보낸다

    def test_cache_and_failures(self):
        self.call()
        count = len(self.httpx.calls)
        self.call()
        self.assertEqual(len(self.httpx.calls), count, "90초 안에는 저장값을 써야 해요")
        self.app.realtime_cache["at"] = -1e9
        self.mode = "beds_down"
        data = self.call()
        self.assertTrue(data["errors"] and not data["hospitals"]["A1"]["has_beds"])
        self.app.realtime_cache["at"] = -1e9
        self.mode = "down"
        self.assertIsInstance(self.call(), dict, "모두 실패하면 직전 값을 보여줘야 해요")

    def test_notices(self):
        current = {"symBlkMsgTyp": "응급", "symTypCod": "Y000", "symTypCodMag": "응급실", "trtPrtCodMag": "소아청소년과",
                   "symBlkMsg": "야간 소아 진료 불가", "symBlkSttDtm": "20000101000000", "symBlkEndDtm": "20991231235900"}
        self.messages = {
            "A2200012": [current, {**current, "symBlkMsg": "지난 공지", "symBlkEndDtm": "20010101000000"}],
            "A2200015": [{"symBlkMsgTyp": "중증", "symTypCod": "Y0032", "symTypCodMag": "뇌출혈수술(거미막하 출혈 외)",
                          "symBlkMsg": "불가능메세지등록", "symBlkSttDtm": "20000101000000", "symBlkEndDtm": "20991231235900"},
                         {**current, "symBlkMsg": "응급실 미운영"}],
        }
        notices = self.call()["notices"]
        self.assertEqual([n["text"] for n in notices["A2200012"]], ["야간 소아 진료 불가"], "끝난 공지는 빼야 해요")
        self.assertEqual(notices["A2200012"][0]["department"], "소아청소년과")
        self.assertEqual(notices["A2200015"][0]["kind"], "응급실", "응급실 공지를 먼저 보여줘야 해요")
        self.assertEqual(notices["A2200015"][1]["illness"], "[뇌출혈수술] 거미막하출혈 외")
        self.assertEqual(notices["A2200015"][1]["text"], "[뇌출혈수술] 거미막하출혈 외 불가")
        self.assertNotIn("A2200001", notices)
        count = len(self.httpx.calls)
        self.app.realtime_cache["at"] = -1e9
        self.call()
        self.assertEqual(len(self.httpx.calls), count + 2, "메시지는 5분에 한 번만 새로 불러와야 해요")

    def test_no_key_and_no_cache(self):
        app, httpx, _ = load_app()
        error = None
        try:
            run(app.app.routes["/api/realtime"](FakeRequest()))
        except app.HTTPException as exc:
            error = exc
        self.assertEqual(error.status_code, 503)


class SymptomParse(unittest.TestCase):
    def setUp(self):
        self.app, _, self.openai = load_app(OPENAI_API_KEY="key")

    def parse(self, output, query):
        self.openai.output = output
        return run(self.app.app.routes["/api/symptom/parse"](FakeRequest(), self.app.SymptomRequest(query=query)))

    def test_valid_and_filtered(self):
        result = self.parse({"category_id": "cardiac", "symptom_keywords": ["가슴 통증", "식은땀", "심근경색"], "is_child": False, "max_minutes": 40},
                            "70대 남성 가슴 통증과 식은땀, 40분 안에")
        self.assertEqual((result.category_id, result.symptom_keywords, result.is_child, result.max_minutes), ("cardiac", ["가슴 통증", "식은땀"], False, 40))
        self.assertIn("- cardiac: 흉통 · 심혈관 의심", self.openai.last["instructions"])

    def test_invalid_values(self):
        result = self.parse({"category_id": "heart", "symptom_keywords": [], "is_child": None, "max_minutes": 0}, "어지러움")
        self.assertEqual((result.category_id, result.max_minutes), ("unclear", None))

    def test_no_key(self):
        app, _, _ = load_app()
        with self.assertRaises(app.HTTPException) as context:
            run(app.app.routes["/api/symptom/parse"](FakeRequest(), app.SymptomRequest(query="흉통")))
        self.assertEqual(context.exception.status_code, 503)


class RouteGeocodeAndLimits(unittest.TestCase):
    def setUp(self):
        self.app, self.httpx, _ = load_app()
        self.httpx.handler = lambda url, headers, params: (200, {"code": 0, "route": {"trafast": [{"summary": {"distance": 1234, "duration": 600000}, "path": [[1, 2]]}]}})
        self.hpid = self.app.get_hospitals()["items"][0]["hpid"]

    def route(self, ip="1.1.1.1", lat=37.75, lon=128.9):
        try:
            return run(self.app.app.routes["/api/route"](FakeRequest(ip), self.hpid, lat, lon))
        except self.app.HTTPException as error:
            return error

    def test_route_cache(self):
        first = self.route()
        nearby = self.route(lat=37.75001, lon=128.90001)
        other = self.route(lat=37.80)
        self.assertNotIn("cached", first)
        self.assertTrue(nearby["cached"])
        self.assertNotIn("cached", other)
        self.assertEqual(len(self.httpx.calls), 2)

    def test_rate_limit_per_ip(self):
        results = [self.route(ip="9.9.9.9") for _ in range(121)]
        self.assertTrue(all(isinstance(item, dict) for item in results[:120]))
        self.assertEqual(results[-1].status_code, 429)
        self.assertIsInstance(self.route(ip="8.8.8.8"), dict)

    def test_geocode(self):
        self.httpx.handler = lambda url, headers, params: (200, {"status": "OK", "addresses": [
            {"roadAddress": "강원특별자치도 강릉시 강릉대로 33", "jibunAddress": "홍제동 1001", "x": "128.89", "y": "37.75"},
            {"roadAddress": "좌표 이상", "jibunAddress": "", "x": "abc", "y": "37"},
            {"roadAddress": "범위 밖", "jibunAddress": "", "x": "500", "y": "37"}]})
        data = run(self.app.app.routes["/api/geocode"](FakeRequest(), "강릉대로 33"))
        self.assertEqual([item["road_address"] for item in data["results"]], ["강원특별자치도 강릉시 강릉대로 33"])
        self.assertEqual(self.httpx.calls[-1][1]["x-ncp-apigw-api-key-id"], "map-id")
        self.httpx.handler = lambda url, headers, params: (401, {})
        with self.assertRaises(self.app.HTTPException) as context:
            run(self.app.app.routes["/api/geocode"](FakeRequest(), "강릉대로 33"))
        self.assertEqual(context.exception.status_code, 502)


class SymptomCases(unittest.TestCase):
    def test_cases_use_known_categories(self):
        app, _, _ = load_app()
        ids = {category["id"] for category in app.get_rules()["categories"]}
        cases = json.loads((TESTS_DIR / "symptom_cases.json").read_text(encoding="utf-8"))["cases"]
        self.assertGreaterEqual(len(cases), 50)
        self.assertEqual([case["id"] for case in cases if case["expected_category"] not in ids], [])


if __name__ == "__main__":
    unittest.main()
