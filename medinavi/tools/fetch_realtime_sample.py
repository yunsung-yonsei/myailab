"""응급실 실시간 가용병상·중증질환 수용가능정보·기본정보(병상 항목)를 샘플로 조회해 실제 응답 항목을 확인한다.

실행 (medinavi 폴더에서):
    python tools/fetch_realtime_sample.py              # hospitals.json 앞 3곳을 자세히, 강원 전체는 요약
    python tools/fetch_realtime_sample.py --hpid A2200008 A2200009

- 인증키는 진료과목 조회와 같은 EMERGENCY_API_KEY를 쓴다 (환경변수 또는 medinavi/.env).
- 전체 응답은 data/realtime_sample_YYYYMMDD_HHMM.json 으로 저장된다 (GitHub에는 올라가지 않음).
- 10~30분 간격으로 2~3번 실행하면 병원별 갱신 속도를 비교할 수 있다.
외부 라이브러리 없이 Python 표준 라이브러리만 사용한다.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_departments import BASE_URL, DATA_PATH, load_service_key  # noqa: E402

KST = timezone(timedelta(hours=9))
REGION_OPERATIONS = {
    "실시간 가용병상": "getEmrrmRlTmUsefulSckbdInfoInqire",
    "중증질환 수용가능": "getSrsillDissAceptncPosblInfoInqire",
}
BASIC_OPERATION = "getEgytBassInfoInqire"
# 강원의 시도 이름이 API에서 어떻게 쓰이는지 확실하지 않아 순서대로 시도한다.
REGION_NAMES = ("강원특별자치도", "강원도")


def call(operation, params, service_key, base_url, timeout=20):
    """API를 불러 (item 목록, 오류 메시지)를 돌려준다. item은 {항목명: 값} 사전이다."""
    query = urllib.parse.urlencode({"serviceKey": service_key, **params})
    try:
        with urllib.request.urlopen(f"{base_url}/{operation}?{query}", timeout=timeout) as response:
            body = response.read()
    except urllib.error.HTTPError as error:
        return [], f"HTTP {error.code}"
    except (urllib.error.URLError, TimeoutError) as error:
        return [], f"연결 실패 ({type(error).__name__})"
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return [], "XML이 아닌 응답: " + body[:120].decode("utf-8", "replace")
    code = root.findtext(".//resultCode") or root.findtext(".//returnReasonCode")
    if code not in ("00", None):
        message = root.findtext(".//resultMsg") or root.findtext(".//returnAuthMsg") or ""
        return [], f"결과코드 {code} {message}".strip()
    items = [{child.tag: (child.text or "").strip() for child in item} for item in root.iter("item")]
    return items, None


def update_age(value, now):
    """'20261112143200' 같은 갱신 시각을 '7분 전'처럼 바꾼다. 형식이 다르면 None."""
    for fmt in ("%Y%m%d%H%M%S", "%Y%m%d%H%M", "%Y-%m-%d %H:%M:%S"):
        try:
            then = datetime.strptime(value, fmt).replace(tzinfo=KST)
            return int((now - then).total_seconds() // 60)
        except (TypeError, ValueError):
            continue
    return None


def summarize_fields(items):
    """항목별로 값이 채워진 병원 수, 음수 값 수, 예시 값을 모은다."""
    stats = {}
    for item in items:
        for name, value in item.items():
            stat = stats.setdefault(name, {"filled": 0, "negative": 0, "examples": []})
            if value:
                stat["filled"] += 1
                if len(stat["examples"]) < 3 and value not in stat["examples"]:
                    stat["examples"].append(value[:30])
                try:
                    if float(value) < 0:
                        stat["negative"] += 1
                except ValueError:
                    pass
    return stats


def main():
    parser = argparse.ArgumentParser(description="실시간 병상·중증질환 수용가능 정보 샘플 조회")
    parser.add_argument("--hpid", nargs="+", help="자세히 볼 기관 ID (기본: hospitals.json 앞 3곳)")
    parser.add_argument("--base-url", default=BASE_URL, help=argparse.SUPPRESS)
    args = parser.parse_args()

    service_key = load_service_key()
    hospitals = json.loads(DATA_PATH.read_text(encoding="utf-8-sig"))["items"]
    our_ids = {item["hpid"]: item.get("dutyName", "") for item in hospitals}
    sample_ids = args.hpid or [item["hpid"] for item in hospitals[:3]]
    now = datetime.now(KST)
    saved = {"retrieved_at": now.isoformat(), "operations": {}}

    for label, operation in REGION_OPERATIONS.items():
        print(f"\n==================== {label} ({operation}) ====================")
        items, error, region_used = [], None, None
        for region in REGION_NAMES:
            items, error = call(operation, {"STAGE1": region, "pageNo": 1, "numOfRows": 200}, service_key, args.base_url)
            if items:
                region_used = region
                break
        if not items:
            print(f"  조회 실패 또는 결과 없음: {error or '항목 0개'} (시도: {', '.join(REGION_NAMES)})")
            saved["operations"][operation] = {"error": error or "no items"}
            continue

        matched = [item for item in items if item.get("hpid") in our_ids]
        print(f"  STAGE1={region_used} · 응답 {len(items)}곳 · hospitals.json 23곳 중 {len(matched)}곳 일치")
        missing = [name for hpid, name in our_ids.items() if hpid not in {item.get('hpid') for item in items}]
        if missing:
            print(f"  응답에 없는 기관 {len(missing)}곳: {', '.join(missing)}")

        print("\n  [항목별 요약: 값이 있는 기관 수 / 음수 개수 / 예시]")
        for name, stat in sorted(summarize_fields(matched or items).items()):
            negative = f" · 음수 {stat['negative']}" if stat["negative"] else ""
            print(f"    {name}: {stat['filled']}곳{negative} · 예: {', '.join(stat['examples']) or '(빈 값)'}")

        ages = [(item.get("dutyName", item.get("hpid")), update_age(item.get("hvidate", ""), now)) for item in matched]
        ages = [(name, age) for name, age in ages if age is not None]
        if ages:
            print("\n  [갱신 시각 (hvidate) 기준 몇 분 전 값인지]")
            for name, age in sorted(ages, key=lambda pair: pair[1]):
                print(f"    {age:>6}분 전 · {name}")

        for hpid in sample_ids:
            item = next((item for item in items if item.get("hpid") == hpid), None)
            print(f"\n  --- {our_ids.get(hpid, hpid)} ({hpid}) 전체 항목 ---")
            if not item:
                print("    응답에 없음")
                continue
            for name, value in sorted(item.items()):
                print(f"    {name} = {value!r}")
        saved["operations"][operation] = {"stage1": region_used, "items": items}
        time.sleep(0.3)

    print(f"\n==================== 기본정보 병상 항목 ({BASIC_OPERATION}) ====================")
    saved["operations"][BASIC_OPERATION] = {}
    for hpid in sample_ids:
        items, error = call(BASIC_OPERATION, {"HPID": hpid, "pageNo": 1, "numOfRows": 10}, service_key, args.base_url)
        print(f"\n  --- {our_ids.get(hpid, hpid)} ({hpid}) ---")
        if error or not items:
            print(f"    조회 실패: {error or '항목 없음'}")
            continue
        # 진료과목처럼 긴 값은 빼고, 병상·시설과 관련 있어 보이는 짧은 숫자·Y/N 값을 모두 보여준다.
        for name, value in sorted(items[0].items()):
            if name == "dgidIdName":
                continue
            print(f"    {name} = {value!r}")
        saved["operations"][BASIC_OPERATION][hpid] = items[0]
        time.sleep(0.2)

    out_path = DATA_PATH.parent / f"realtime_sample_{now:%Y%m%d_%H%M}.json"
    out_path.write_text(json.dumps(saved, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n전체 응답을 {out_path.relative_to(DATA_PATH.parent.parent)} 에 저장했어요. (GitHub에는 올라가지 않아요)")
    print("10~30분 뒤 한 번 더 실행하면 갱신 속도를 비교할 수 있어요.")


if __name__ == "__main__":
    main()
