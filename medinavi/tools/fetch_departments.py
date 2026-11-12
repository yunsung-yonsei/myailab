"""국립중앙의료원 '응급의료기관 기본정보 조회'로 병원별 등록 진료과목(dgidIdName)을 확인한다.

1단계 (몇 곳만 확인, 파일은 바꾸지 않음):
    python tools/fetch_departments.py --sample 3
    python tools/fetch_departments.py --hpid A2200008 A1100017

2단계 (23곳 전체를 조회해 data/hospitals.json에 합침):
    python tools/fetch_departments.py --write

인증키는 공공데이터포털의 일반 인증키를 환경변수 DATA_GO_KR_SERVICE_KEY로 넣는다.
(medinavi/.env 에 DATA_GO_KR_SERVICE_KEY=... 를 적어도 된다. Encoding/Decoding 키 모두 사용 가능)
외부 라이브러리 없이 Python 표준 라이브러리만 사용한다.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_PATH = BASE_DIR / "data" / "hospitals.json"
BASE_URL = "https://apis.data.go.kr/B552657/ErmctInfoInqireService"
OPERATION = "getEgytBassInfoInqire"
UNKNOWN = "확인 필요"


def load_service_key():
    """환경변수 또는 medinavi/.env 에서 인증키를 읽는다. 값은 화면에 출력하지 않는다."""
    key = os.getenv("DATA_GO_KR_SERVICE_KEY", "").strip()
    env_path = BASE_DIR / ".env"
    if not key and env_path.exists():
        for line in env_path.read_text(encoding="utf-8-sig").splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "DATA_GO_KR_SERVICE_KEY":
                key = value.strip().strip('"').strip("'")
    if not key:
        sys.exit("DATA_GO_KR_SERVICE_KEY 를 환경변수나 medinavi/.env 에 넣어 주세요.")
    # Encoding 키(%2B 등 포함)를 넣어도 이중 인코딩되지 않도록 한 번 풀어 둔다.
    return urllib.parse.unquote(key)


def split_departments(raw):
    """'내과,소아청소년과, 외과' 같은 값을 목록으로 바꾼다. 순서를 유지하고 중복은 뺀다."""
    names = [name.strip() for name in re.split(r"[,，、/]", raw or "")]
    return list(dict.fromkeys(name for name in names if name))


def fetch_detail(hpid, service_key, base_url=BASE_URL, timeout=15):
    """기관 ID 하나의 기본정보를 조회해 (원래 dgidIdName 값, 기관명, 오류 메시지)를 돌려준다."""
    query = urllib.parse.urlencode({"serviceKey": service_key, "HPID": hpid, "pageNo": 1, "numOfRows": 10})
    url = f"{base_url}/{OPERATION}?{query}"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body = response.read()
    except urllib.error.HTTPError as error:
        return None, None, f"HTTP {error.code}"
    except (urllib.error.URLError, TimeoutError) as error:
        return None, None, f"연결 실패 ({type(error).__name__})"

    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        # 인증키 오류는 XML이 아닌 짧은 문장으로 오기도 한다.
        return None, None, "XML이 아닌 응답: " + body[:120].decode("utf-8", "replace")

    code = root.findtext(".//resultCode") or root.findtext(".//returnReasonCode")
    if code not in ("00", None):
        message = root.findtext(".//resultMsg") or root.findtext(".//returnAuthMsg") or ""
        return None, None, f"결과코드 {code} {message}".strip()

    item = root.find(".//item")
    if item is None:
        return None, None, "응답에 기관 정보(item)가 없음"
    return item.findtext("dgidIdName"), item.findtext("dutyName"), None


def main():
    parser = argparse.ArgumentParser(description="병원별 등록 진료과목(dgidIdName) 조회")
    parser.add_argument("--sample", type=int, metavar="N", help="hospitals.json 앞쪽 N곳만 조회해 보기")
    parser.add_argument("--hpid", nargs="+", help="조회할 기관 ID 직접 지정")
    parser.add_argument("--write", action="store_true", help="전체 조회 결과를 data/hospitals.json 에 저장")
    parser.add_argument("--base-url", default=BASE_URL, help=argparse.SUPPRESS)
    args = parser.parse_args()

    data = json.loads(DATA_PATH.read_text(encoding="utf-8-sig"))
    items = data["items"]
    if args.hpid:
        targets = [item for item in items if item.get("hpid") in args.hpid]
        targets += [{"hpid": hpid} for hpid in args.hpid if hpid not in {item.get("hpid") for item in items}]
    elif args.sample:
        targets = items[: args.sample]
    elif args.write:
        targets = items
    else:
        parser.error("--sample N, --hpid ID..., --write 중 하나를 지정해 주세요.")

    service_key = load_service_key()
    counter = Counter()
    unknown = []
    for index, hospital in enumerate(targets, 1):
        hpid = hospital.get("hpid", "")
        raw, api_name, error = fetch_detail(hpid, service_key, args.base_url) if hpid else (None, None, "hpid 없음")
        departments = split_departments(raw)
        name = hospital.get("dutyName") or api_name or "기관명 확인 필요"

        print(f"\n[{index}/{len(targets)}] {name} ({hpid})")
        if error:
            print(f"  조회 실패: {error}")
        else:
            print(f"  원래 값(dgidIdName): {raw!r}")
            print(f"  진료과목 {len(departments)}개: {', '.join(departments) or '(빈 값)'}")

        if departments:
            counter.update(departments)
        else:
            unknown.append(name)
        if args.write and "dutyName" in hospital:
            hospital["departments"] = departments
            hospital["departments_status"] = "등록 확인" if departments else UNKNOWN
        time.sleep(0.2)  # 공공 API에 연속 요청 부담을 줄인다.

    print("\n=== 전체 진료과목 (등록한 병원 수 순) ===")
    for department, count in counter.most_common():
        print(f"  {department}: {count}곳")
    print(f"\n진료과목 종류 {len(counter)}개 · 조회 {len(targets)}곳 · 확인 필요 {len(unknown)}곳")
    if unknown:
        print("  확인 필요: " + ", ".join(unknown))

    if args.write:
        data["departments_source"] = f"국립중앙의료원 전국 응급의료기관 정보 조회 서비스 ({OPERATION})"
        data["departments_retrieved_at"] = datetime.now(timezone.utc).isoformat()
        DATA_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"\n{DATA_PATH.relative_to(BASE_DIR)} 에 저장했어요.")
    else:
        print("\n(확인만 했고 파일은 바꾸지 않았어요. 저장하려면 --write 로 실행하세요.)")


if __name__ == "__main__":
    main()
