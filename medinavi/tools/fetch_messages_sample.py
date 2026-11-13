"""응급실 및 중증질환 메시지(병원이 직접 올리는 공지)를 조회해 실제 응답 모양을 확인한다.

실행 (medinavi 폴더에서):
    python tools/fetch_messages_sample.py                 # hospitals.json 23곳 전체
    python tools/fetch_messages_sample.py --hpid A2200001  # 특정 병원만

- 활용가이드 9번 '응급실 및 중증질환 메시지 조회'(getEmrrmSrsillDissMsgInqire)를 쓴다.
- 인증키는 EMERGENCY_API_KEY (환경변수 또는 medinavi/.env). 키 값은 화면에 출력하지 않는다.
- 응답 항목 이름을 확실히 알기 위해, 처음 나온 메시지는 모든 항목을 그대로 보여준다.
- 전체 응답은 data/messages_sample_YYYYMMDD_HHMM.json 으로 저장된다 (GitHub에는 올라가지 않음).
- 하루 중 시간대를 바꿔(낮·밤) 2~3번 실행하면 메시지가 얼마나 자주 바뀌는지 볼 수 있다.
"""

import argparse
import json
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_departments import BASE_URL, DATA_PATH, load_service_key  # noqa: E402
from fetch_realtime_sample import call  # noqa: E402

KST = timezone(timedelta(hours=9))
OPERATION = "getEmrrmSrsillDissMsgInqire"
# 메시지 내용·종류·기간으로 짐작되는 항목. 실제 이름이 다르면 아래 '전체 항목'에서 확인한다.
LIKELY_TEXT_FIELDS = ("symBlkMsg", "symBlkMsgTyp", "symTypCodMag", "symTypCod",
                      "symOutDspYon", "symOutDspMth", "symBlkSttDtm", "symBlkEndDtm")


def main():
    parser = argparse.ArgumentParser(description="응급실·중증질환 메시지 샘플 조회")
    parser.add_argument("--hpid", nargs="*", help="조회할 기관 ID (생략하면 hospitals.json 전체)")
    args = parser.parse_args()

    service_key = load_service_key()
    if not service_key:
        sys.exit("EMERGENCY_API_KEY를 찾지 못했어요. 환경변수나 medinavi/.env 에 넣어 주세요.")

    hospitals = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    hospitals = hospitals.get("items", hospitals) if isinstance(hospitals, dict) else hospitals
    names = {h["hpid"]: h.get("dutyName", "") for h in hospitals}
    targets = args.hpid or list(names)

    now = datetime.now(KST)
    print(f"조회 시각: {now:%Y-%m-%d %H:%M} · 대상 {len(targets)}곳\n")

    results, field_counter, shown_full = {}, Counter(), False
    for hpid in targets:
        items, error = call(OPERATION, {"HPID": hpid, "pageNo": 1, "numOfRows": 100}, service_key, BASE_URL)
        results[hpid] = {"name": names.get(hpid, ""), "error": error, "items": items}
        label = f"{names.get(hpid, '')} ({hpid})"
        if error:
            print(f"[오류] {label}: {error}")
        elif not items:
            print(f"[없음] {label}")
        else:
            print(f"[{len(items)}건] {label}")
            for item in items:
                field_counter.update(item.keys())
                if not shown_full:
                    print("   ── 처음 나온 메시지의 전체 항목 ──")
                    for key, value in item.items():
                        print(f"   {key}: {value}")
                    print("   ───────────────────────────")
                    shown_full = True
                summary = " | ".join(f"{key}={item[key]}" for key in LIKELY_TEXT_FIELDS if item.get(key))
                print(f"   · {summary or item}")
        time.sleep(0.2)

    with_messages = sum(1 for r in results.values() if r["items"])
    total = sum(len(r["items"]) for r in results.values())
    print(f"\n=== 메시지가 있는 기관 {with_messages}/{len(targets)}곳 · 메시지 {total}건 ===")
    if field_counter:
        print("응답에 나온 항목 이름(나온 횟수):", ", ".join(f"{k}({v})" for k, v in field_counter.most_common()))

    out = DATA_PATH.parent / f"messages_sample_{now:%Y%m%d_%H%M}.json"
    out.write_text(json.dumps({"retrieved_at": now.isoformat(), "results": results},
                              ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"전체 응답을 {out.relative_to(DATA_PATH.parent.parent)} 에 저장했어요.")


if __name__ == "__main__":
    main()
