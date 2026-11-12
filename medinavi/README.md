# MediNavi — 강원 응급의료기관 지도

강원 응급의료기관 23곳을 네이버 지도에 표시하고, 현재 위치에서 선택한 병원까지의 자동차 경로·예상 시간·거리를 보여 줍니다.

- 배포 주소: <https://medinavi.onrender.com>
- 배포 방식: Render Web Service (`main` 브랜치에 커밋하면 자동 배포)

## 1. 파일 구성

| 파일 | 하는 일 |
| --- | --- |
| `app.py` | 화면·병원 데이터를 전달하고 네이버 자동차 길찾기를 요청하는 FastAPI 서버 |
| `frontend/index.html` | 지도·병원 목록·상세정보 화면과 모바일 스타일 |
| `frontend/map.js` | 지도 표시, 현재 위치, 병원 목록, 거리·시간 조회 |
| `frontend/hospital-route-view.js` | 선택 병원 초록 핀 강조, 빨간 내 위치 점 유지, 경로선, 시간·거리 상자 |
| `data/hospitals.json` | 강원 23개 의료기관의 항목명·값·출처·조회 시점, 등록 진료과목(`departments`) |
| `tools/fetch_departments.py` | 기관 ID로 국립중앙의료원 기본정보를 조회해 등록 진료과목을 `hospitals.json`에 합치는 스크립트 |
| `requirements.txt` | 서버 실행에 필요한 Python 라이브러리 |
| `.env.example` | 실제 인증정보가 없는 환경변수 입력 양식 |
| `server.ipynb` | 개발용 노트북 (Git 업로드 제외 대상) |

## 2. Render 배포 설정

Render 대시보드의 **medinavi** 서비스 → **Settings**에 다음 값이 들어가 있어야 합니다.

| 항목 | 값 |
| --- | --- |
| Source / Branch | `yunsung-yonsei/myailab` / `main` |
| Root Directory | `medinavi` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn app:app --host 0.0.0.0 --port $PORT --no-access-log` |
| Auto-Deploy | On Commit |

**Environment** 메뉴에는 다음 두 환경변수를 넣습니다. 값은 GitHub·채팅·화면 코드에 넣지 않습니다.

- `NAVER_MAPS_CLIENT_ID`: 네이버 Maps 인증 ID
- `NAVER_MAPS_CLIENT_SECRET`: 네이버 Maps 인증 비밀키

`--no-access-log`는 좌표가 포함된 요청 주소를 접속 로그에 남기지 않도록 하는 옵션입니다.

## 3. 외부 설정 확인

- 네이버 Maps 애플리케이션에서 **Web Dynamic Map**과 **Directions 5**를 사용할 수 있어야 합니다.
- 네이버 Maps의 Web 서비스 URL에 `https://medinavi.onrender.com`(로컬 시험 시 `http://localhost:8000`)이 등록되어야 지도가 열립니다.
- 웹 지도는 `frontend/index.html`의 공개 Client ID를 사용합니다. Render 환경변수의 인증정보도 같은 Maps 애플리케이션 것이어야 합니다.
- Render 무료 인스턴스는 한동안 접속이 없으면 잠들어, 첫 접속이 30초~1분 정도 느릴 수 있습니다.

## 4. 내 PC에서 시험하기 (선택)

`medinavi` 폴더를 VS Code로 열고 터미널에서 실행합니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

`.env.example`을 복사해 이름을 `.env`로 바꾸고 두 값을 입력한 뒤 서버를 실행합니다. 파일명은 `.env.txt`가 아닌 `.env`입니다.

```powershell
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000 --no-access-log
```

크롬에서 <http://localhost:8000/>을 엽니다. 종료는 `Ctrl+C`입니다. macOS/Linux에서는 실행 파일 경로를 `.venv/bin/python`으로 바꿉니다.

## 5. 기능 확인 순서

1. 병원 23곳의 목록·핀과 기본정보가 보이는지 확인합니다. 없는 항목은 `확인 필요`, 좌표가 없는 기관은 목록에 `좌표 없음`으로 표시합니다.
2. 지도 준비 후 위치를 한 번 요청하고 빨간 현재 위치 점을 표시합니다. 실패하면 `내 위치` 버튼으로 재시도합니다.
3. 병원을 누르면 초록색으로 약 두 배 커진 병원 핀, 빨간 출발지 점, 초록 도로 경로가 함께 보입니다.
4. 경로 옆 검은 상자에 `약 N분`과 `N.Nkm`가 두 줄로 표시됩니다.
5. 다른 병원을 누르면 경로·상자가 교체됩니다. `전체 보기`는 경로·상자를 지우고 전체 병원 핀을 복원합니다.

휴대폰에서는 `https://medinavi.onrender.com`으로 접속합니다. 위치 기능은 HTTPS 주소에서만 동작합니다.

### 등록 진료과목 검색

- 조건 검색의 **등록 진료과목**은 선택 조건입니다. 고르면 기관 유형과 진료과목으로 후보를 먼저 줄인 뒤 길찾기로 이동시간을 비교합니다.
- 결과에는 `○○과 등록 확인 · 현재 수용 여부 확인 필요`로 표시합니다. 등록 진료과목은 현재 진료·응급환자 수용 가능 여부를 뜻하지 않습니다.
- 진료과목 자료가 비어 있는 기관은 결과에서 빼고 **진료과목 확인 필요** 목록에 따로 보여줍니다.
- 병원마다 이름이 다른 같은 과목은 `app.py`의 `DEPARTMENT_ALIASES`에서 묶습니다 (예: `구강안면외과` → `구강악안면외과`).
- 진료과목 자료를 새로 받으려면 `medinavi/.env`에 `EMERGENCY_API_KEY`를 넣고 `python tools/fetch_departments.py --write`를 실행합니다. 먼저 `--sample 3`으로 몇 곳만 확인할 수 있습니다.

## 6. 코드와 변수 설명

`frontend/map.js`는 기존 코드의 모든 줄·변수명을 유지하고, `window.hospitalRouteView`를 부르는 연결 코드와 한글 주석만 추가했습니다. 추가 동작은 `frontend/hospital-route-view.js`에 모아 두었으며, 기존 거리 조회 응답의 `path`를 재사용하므로 경로 표시만을 위한 중복 API 호출은 없습니다.

| 이름 | 뜻 |
| --- | --- |
| `selectedHospital` | 현재 선택한 병원 |
| `locationMarker` | 기존 빨간 현재 위치 점 |
| `routeLine` / `routeLabel` | 경로선 / 시간·거리 상자 |
| `hospitals` | 기관 ID별 병원 핀과 원래 모양 |
| `register` / `select` | 원본 핀 전달 / 선택 병원 변경 |
| `draw` | 받은 도로 좌표로 경로 표시 |
| `locationReset` / `locationReady` | 위치 재조회 시 정리 / 위치 확인 후 경로 조회 |
| `showAll` | 경로 정리와 전체 병원 핀 복원 |

## 7. 변경 기록과 참고

- 이전에 따로 두었던 `_update_v1` 파일들의 기능을 원본 파일에 합쳤습니다. 이전 구성은 Git 기록에서 확인할 수 있습니다.
- 실제 `.env`·로그·가상환경은 업로드 대상에서 제외합니다 (`.gitignore`).

병원 JSON은 저장 당시 정보이며 현재 수술·수용 가능 여부를 판단하지 않습니다. 경로는 `trafast` 옵션의 일반 자동차 기준 예상이며, 구급차 특례 주행이나 주행 중 자동 재탐색은 포함하지 않습니다.
