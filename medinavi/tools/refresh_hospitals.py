"""강원 응급의료기관 목록을 국립중앙의료원 API로 다시 받아 data/hospitals.json과 비교한다.

실행 (medinavi 폴더에서):
    python tools/refresh_hospitals.py            # 바뀐 곳만 보여주고 파일은 그대로 둔다
    python tools/refresh_hospitals.py --write    # 바뀐 기본 정보와 외상센터 여부를 hospitals.json에 반영한다

- 응급의료기관 목록정보 조회(getEgytListInfoInqire): 기관 유형, 이름, 주소, 전화, 좌표 비교
- 외상센터 목록정보 조회(getStrmListInfoInqire): 외상센터인 기관을 trauma_center=true로 표시
- 새로 생긴 기관은 --write 때 추가하고 진료과목은 '확인 필요'로 둔다 (이후 fetch_departments.py --write 실행).
- 목록에서 사라진 기관은 자동으로 지우지 않고 알려만 준다. 지우려면 --remove-missing 을 함께 쓴다.
인증키는 EMERGENCY_API_KEY (진료과목 조회와 같음). 한 달에 한 번 정도 실행을 권장한다.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_departments import BASE_URL, DATA_PATH, load_service_key  # noqa: E402
from fetch_realtime_sample import call  # noqa: E402

REGION_NAMES = ("강원특별자치도", "강원도")
COMPARE_FIELDS = ("dutyEmcls", "dutyEmclsName", "dutyName", "dutyAddr", "dutyTel1", "dutyTel3", "wgs84Lat", "wgs84Lon")
FIELD_NAMES = {"dutyEmcls": "기관분류코드", "dutyEmclsName": "기관 유형", "dutyName": "기관명", "dutyAddr": "주소",
               "dutyTel1": "대표전화", "dutyTel3": "응급실 전화", "wgs84Lat": "위도", "wgs84Lon": "경도"}


def fetch_region(operation, service_key, base_url):
    """강원 전체 목록을 받아 {기관ID: 항목} 으로 돌려준다."""
    last_error = None
    for region in REGION_NAMES:
        items, error = call(operation, {"Q0": region, "pageNo": 1, "numOfRows": 100}, service_key, base_url)
        if items:
            return {item["hpid"]: item for item in items if item.get("hpid")}, region, None
        last_error = error or "항목 0개"
    return {}, None, last_error


def same_value(field, old, new):
    # 좌표는 소수점 아래 표기 차이를 무시하고 비교한다.
    if field in ("wgs84Lat", "wgs84Lon"):
        try:
            return abs(float(old) - float(new)) < 1e-6
        except (TypeError, ValueError):
            pass
    return (old or "").strip() == (new or "").strip()


def main():
    parser = argparse.ArgumentParser(description="강원 응급의료기관 목록 갱신")
    parser.add_argument("--write", action="store_true", help="바뀐 내용을 hospitals.json 에 반영")
    parser.add_argument("--remove-missing", action="store_true", help="--write 와 함께 쓰면 목록에서 사라진 기관을 지움")
    parser.add_argument("--base-url", default=BASE_URL, help=argparse.SUPPRESS)
    args = parser.parse_args()

    service_key = load_service_key()
    data = json.loads(DATA_PATH.read_text(encoding="utf-8-sig"))
    current = {item["hpid"]: item for item in data["items"]}

    latest, region, error = fetch_region("getEgytListInfoInqire", service_key, args.base_url)
    if not latest:
        sys.exit(f"응급의료기관 목록을 받지 못했어요: {error}")
    trauma, _, trauma_error = fetch_region("getStrmListInfoInqire", service_key, args.base_url)

    added = [hpid for hpid in latest if hpid not in current]
    missing = [hpid for hpid in current if hpid not in latest]
    changes = {}
    for hpid in latest.keys() & current.keys():
        diff = [(field, current[hpid].get(field), latest[hpid].get(field)) for field in COMPARE_FIELDS
                if not same_value(field, current[hpid].get(field), latest[hpid].get(field))]
        if diff:
            changes[hpid] = diff

    print(f"조회 지역: {region} · API {len(latest)}곳 · hospitals.json {len(current)}곳")
    print(f"\n[새로 생긴 기관] {len(added)}곳")
    for hpid in added:
        print(f"  + {latest[hpid].get('dutyName')} ({hpid}) · {latest[hpid].get('dutyEmclsName')}")
    print(f"\n[목록에서 사라진 기관] {len(missing)}곳")
    for hpid in missing:
        print(f"  - {current[hpid].get('dutyName')} ({hpid}) · {current[hpid].get('dutyEmclsName')}")
    print(f"\n[정보가 바뀐 기관] {len(changes)}곳")
    for hpid, diff in changes.items():
        print(f"  * {current[hpid].get('dutyName')} ({hpid})")
        for field, old, new in diff:
            print(f"      {FIELD_NAMES[field]}: {old!r} → {new!r}")

    print("\n[외상센터]")
    if trauma:
        for hpid, item in trauma.items():
            mark = "" if hpid in latest else " (응급의료기관 목록에는 없음)"
            print(f"  · {item.get('dutyName')} ({hpid}){mark}")
    else:
        print(f"  조회 실패 또는 없음: {trauma_error} (외상센터 표시는 바꾸지 않아요)")

    if not args.write:
        print("\n(확인만 했고 파일은 바꾸지 않았어요. 반영하려면 --write 로 실행하세요.)")
        return

    for hpid, diff in changes.items():
        for field, _, new in diff:
            current[hpid][field] = new
    for hpid in added:
        item = {field: latest[hpid].get(field, "") for field in ("hpid", "phpid", "rnum", *COMPARE_FIELDS)}
        item.update(departments=[], departments_status="확인 필요")
        data["items"].append(item)
        current[hpid] = item
    if args.remove_missing and missing:
        data["items"] = [item for item in data["items"] if item["hpid"] not in missing]
    if trauma:
        for item in data["items"]:
            item["trauma_center"] = item["hpid"] in trauma
        data["trauma_source"] = "국립중앙의료원 전국 응급의료기관 정보 조회 서비스 (getStrmListInfoInqire)"
    data["retrieved_at"] = datetime.now(timezone.utc).isoformat()
    data["totalCount"] = str(len(data["items"]))
    DATA_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n{DATA_PATH.relative_to(DATA_PATH.parent.parent)} 에 반영했어요.")
    if added:
        print("새 기관의 진료과목은 python tools/fetch_departments.py --write 로 채워 주세요.")


if __name__ == "__main__":
    main()
