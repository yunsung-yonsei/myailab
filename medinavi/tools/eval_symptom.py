"""AI 증상 분류를 시험 문장 세트(tests/symptom_cases.json)로 채점한다. (12월 평가 항목 '조건 추출 정확도')

실행 (medinavi 폴더에서):
    python tools/eval_symptom.py                                   # 배포 사이트(https://medinavi.onrender.com)로 채점
    python tools/eval_symptom.py --url http://127.0.0.1:8000        # 내 PC에서 띄운 서버로 채점

- 서버의 호출 제한(분당 10번)에 걸리지 않도록 문장 사이에 6.5초씩 쉰다. 50문장이면 약 6분 걸린다.
- 결과는 화면에 요약하고, 문장별 결과는 data/eval_symptom_날짜_시각.json 으로 저장한다 (GitHub에는 올라가지 않음).
외부 라이브러리 없이 Python 표준 라이브러리만 사용한다.
"""

import argparse
import json
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def classify(url, text):
    request = urllib.request.Request(url.rstrip("/") + "/api/symptom/parse", data=json.dumps({"query": text}).encode("utf-8"),
                                     headers={"Content-Type": "application/json"}, method="POST")
    for attempt in range(2):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8")), None
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt == 0:
                time.sleep(61)   # 호출 제한에 걸리면 1분 쉬고 한 번 더 시도한다.
                continue
            return None, f"HTTP {error.code}"
        except (urllib.error.URLError, TimeoutError) as error:
            return None, f"연결 실패 ({type(error).__name__})"
    return None, "재시도 실패"


def main():
    parser = argparse.ArgumentParser(description="AI 증상 분류 채점")
    parser.add_argument("--url", default="https://medinavi.onrender.com")
    parser.add_argument("--cases", default=str(BASE_DIR / "tests" / "symptom_cases.json"))
    parser.add_argument("--delay", type=float, default=6.5)
    args = parser.parse_args()

    cases = json.loads(Path(args.cases).read_text(encoding="utf-8"))["cases"]
    results, per_category, misses = [], defaultdict(Counter), []
    child_total = child_correct = 0
    for index, case in enumerate(cases, 1):
        output, error = classify(args.url, case["text"])
        got = output.get("category_id") if output else None
        ok = got == case["expected_category"]
        per_category[case["expected_category"]]["total"] += 1
        per_category[case["expected_category"]]["correct"] += ok
        if case["expected_is_child"] is not None and output:
            child_total += 1
            child_correct += output.get("is_child") == case["expected_is_child"]
        mark = "O" if ok else "X"
        print(f"[{index:2}/{len(cases)}] {mark} 기대 {case['expected_category']:<11} 결과 {got or error!s:<11} · {case['text']}"
              + (f" · 참고 표현 {output.get('symptom_keywords')}" if output else ""))
        if not ok:
            misses.append((case, got or error))
        results.append({**case, "result": output, "error": error, "correct": ok})
        if index < len(cases):
            time.sleep(args.delay)

    total = len(cases)
    correct = sum(item["correct"] for item in results)
    print(f"\n=== 증상 분류 정확도: {correct}/{total} ({correct / total:.0%}) ===")
    for category, count in sorted(per_category.items()):
        print(f"  {category:<11} {count['correct']}/{count['total']}")
    if child_total:
        print(f"소아 여부 정확도: {child_correct}/{child_total} ({child_correct / child_total:.0%})")
    if misses:
        print("\n[틀린 문장]")
        for case, got in misses:
            print(f"  #{case['id']} 기대 {case['expected_category']} → 결과 {got}: {case['text']}")

    out = BASE_DIR / "data" / f"eval_symptom_{datetime.now():%Y%m%d_%H%M}.json"
    out.write_text(json.dumps({"url": args.url, "accuracy": correct / total, "results": results}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n문장별 결과를 {out.relative_to(BASE_DIR)} 에 저장했어요.")


if __name__ == "__main__":
    main()
