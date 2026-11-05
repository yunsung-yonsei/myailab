import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse


BASE_DIR = Path(__file__).resolve().parent
# 파일을 medinavi 바로 아래에 모았다. 기존 변수명과 조회 기능은 유지한다.
FRONTEND_DIR = BASE_DIR
DATA_PATH = BASE_DIR / "hospitals.json"

load_dotenv(BASE_DIR / ".env", encoding="utf-8-sig")

NAVER_CLIENT_ID = os.getenv("NAVER_MAPS_CLIENT_ID", "").strip()
NAVER_CLIENT_SECRET = os.getenv("NAVER_MAPS_CLIENT_SECRET", "").strip()

if not NAVER_CLIENT_ID or not NAVER_CLIENT_SECRET:
    raise RuntimeError("네이버 Maps 인증정보를 확인하세요.")

app = FastAPI()

# 화면에 필요한 두 파일만 제공한다. 폴더 전체를 공개하면 .env도 노출될 수 있다.
PUBLIC_FILES = {"map.js", "hospital-route-view.js"}

@app.get("/static/{file_name}")
def get_public_file(file_name: str):
    if file_name not in PUBLIC_FILES:
        raise HTTPException(status_code=404, detail="파일을 찾지 못했습니다.")
    return FileResponse(FRONTEND_DIR / file_name, media_type="text/javascript")

@app.get("/")
def home():
    return FileResponse(FRONTEND_DIR / "index.html")

@app.get("/api/hospitals")
def get_hospitals():
    try:
        with DATA_PATH.open("r", encoding = "utf-8-sig") as file:
            data = json.load(file)

    except FileNotFoundError:
        raise HTTPException(status_code = 500, detail = "의료기관 데이터 파일을 찾지 못했습니다.",)

    except json.JSONDecodeError:
        raise HTTPException(status_code = 500, detail = "의료기관 JSON 파일의 형식을 확인하세요.",)

    # 출처, 조회 시점, items를 포함한 기존 구조를 유지

    return data

DIRECTIONS_URL = "https://maps.apigw.ntruss.com/map-direction/v1/driving"

@app.get("/api/route")
async def get_route(hospital_id: str, start_lat: float = Query(..., ge = -90, le = 90), start_lon: float = Query(..., ge = -180, le = 180)):

    # 기존 병원 목록 기능에서 데이터를 읽음

    print(f"[길찾기 요청 도착] 병원 ID = {hospital_id}", flush = True)
    
    hospitals = get_hospitals()["items"]

    hospital = next((item for item in hospitals if item.get("hpid") == hospital_id), None,)

    if hospital is None:
        raise HTTPException(404, "의료기관을 찾지 못했습니다.")

    try:
        goal_lat = float(hospital["wgs84Lat"])
        goal_lon = float(hospital["wgs84Lon"])

    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code = 422, detail = "의료기관 좌표를 확인해야 합니다.") from None

    if not(math.isfinite(goal_lat) and math.isfinite(goal_lon) and -90 <= goal_lat <= 90 and -180 <= goal_lon <= 180):
        raise HTTPException(status_code = 422, detail = "의료기관 좌표가 유효한 범위를 벗어났습니다.",)

    # 성공한 진단 셀과 같은 방식으로 요청

    headers = {"x-ncp-apigw-api-key-id": NAVER_CLIENT_ID, "x-ncp-apigw-api-key": NAVER_CLIENT_SECRET,}

    # trafast: 실시간 빠른 길 

    params = {"start": f"{start_lon},{start_lat}", "goal": f"{goal_lon},{goal_lat}", "option": "trafast"}

    try:
        async with httpx.AsyncClient(timeout = 20) as client:
            response = await client.get(DIRECTIONS_URL, headers = headers, params = params,)

    except httpx.TimeoutException as error:
        raise HTTPException(status_code = 504, detail = f"길찾기 응답 시간이 초과({type(error).__name__})",) from None

    except httpx.RequestError as error:
        raise HTTPException(status_code = 502, detail = f"길찾기 연결 오류 ({type(error).__name__})",) from None

    try:
        data = response.json()

    except ValueError:
        raise HTTPException(status_code = 502, detail = "길찾기 응답을 JSON으로 읽지 못했습니다.",) from None

    if not isinstance(data, dict):
        raise HTTPException(status_code = 502, detail = "길찾기 응답 형식을 확인해 주세요.",)

    route_errors = {"1": "출발지와 목적지가 같은 지점으로 인식됐어요.", "2": "출발지 또는 병원 위치가 도로 주변에 있지 않아 경로를 찾지 못했어요.",
                    "3": "두 지점 사이의 자동차 경로를 찾지 못했어요.",}

    route_error = route_errors.get(str(data.get("code")))

    if response.status_code == 400 and route_error:
        raise HTTPException(status_code = 422, detail = route_error)

    if response.status_code != 200:
        raise HTTPException(status_code = 502, detail = f"네이버 길찾기에서 HTTP {response.status_code} 응답을 받았어요.",)

    if data.get("code") != 0:
        raise HTTPException(422, "경로를 찾지 못했어요. 출발지와 병원 위치를 확인해 주세요.")

    try:
        route = data["route"]["trafast"][0]
        summary = route["summary"]

        return {"hospital_id": hospital_id, "hospital_name": hospital.get("dutyName"), "distance_m": summary["distance"], "duration_ms": summary["duration"],
                "path": route["path"], "route_options": "trafast", "source": "NAVER Maps Direction 5", "queried_at": datetime.now(timezone.utc).isoformat(),}

    except (KeyError, IndexError, TypeError):
        raise HTTPException(status_code = 502, detail = "길찾기 결과에 필요한 정보가 없습니다.") from None
