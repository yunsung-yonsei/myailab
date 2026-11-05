# MediNavi update_v1 — Automatic Location and Hospital Routes

**새 기능은 이름에 `update_v1`이 붙은 파일로 실행합니다.** 팀장님 원본 `app.py`, `requirements.txt`, `server.ipynb`, `frontend/`, `data/`는 원래 구성으로 보존합니다.

## 1. 이 버전 받기

GitHub에서 `medinavi-location-and-routes` 브랜치를 선택한 뒤 **Code → Download ZIP**으로 전체를 받습니다. Git을 사용한다면 기존 작업 폴더 밖에서 다음 명령을 실행합니다.

```powershell
git clone --branch medinavi-location-and-routes https://github.com/yunsung-yonsei/myailab.git medinavi-update-v1
cd medinavi-update-v1/medinavi
```

기본 `main`에는 이 추가 기능이 아직 병합되지 않았습니다. 위 브랜치의 파일을 받아야 합니다.

## 2. 필요한 파일

다음 8개를 같은 `medinavi` 폴더에 둡니다. 실제 `.env` 또는 서버 환경변수는 실행하는 사람이 별도로 준비합니다.

| 파일 | 하는 일 |
| --- | --- |
| `app_update_v1.py` | update_v1 화면·데이터를 전달하고 네이버 자동차 길찾기를 요청하는 서버 |
| `index_update_v1.html` | 지도·병원 목록·상세정보 화면과 모바일 스타일 |
| `map_update_v1.js` | 기존 지도·현재 위치·거리 조회 코드에 추가 기능 연결 |
| `hospital-route-view_update_v1.js` | 큰 초록 병원 핀, 빨간 내 위치 점 유지, 경로선, 시간·거리 상자, 첫 방문 위치 조회 |
| `hospitals_update_v1.json` | 기존 강원 23개 의료기관의 항목명·값·출처·조회 시점을 보존한 데이터 |
| `requirements_update_v1.txt` | 검증에 사용한 Python 라이브러리와 버전 |
| `env_update_v1.example` | 실제 인증정보가 없는 빈 입력 양식 |
| `README_update_v1.md` | 이 실행 방법과 인수인계 설명 |

원본 `frontend/`·`data/`는 삭제하거나 이름을 바꾸지 않습니다. 원본 `app.py`를 실행하면 기존 버전, `app_update_v1.py` 모듈로 서버를 실행하면 추가 기능 버전입니다. update_v1은 위의 버전 표시 파일을 읽으며 원본 폴더를 수정하지 않습니다.

## 3. Windows에서 처음 실행하기

Python이 설치된 PC에서 `medinavi` 폴더를 VS Code로 열고 터미널을 엽니다.

1. 기존 환경과 별도로 update_v1 전용 가상환경을 만들고 설치합니다.

   ```powershell
   python -m venv .venv/update_v1
   .\.venv\update_v1\Scripts\python.exe -m pip install -r requirements_update_v1.txt
   ```

2. `medinavi` 바로 아래의 기존 `.env`가 있으면 그대로 사용합니다. 없다면 `env_update_v1.example`을 복사하여 이름을 `.env`로 바꾸고, 본인 PC에서 다음 값을 입력합니다.

   - `NAVER_MAPS_CLIENT_ID`: 네이버 Maps 인증 ID
   - `NAVER_MAPS_CLIENT_SECRET`: 네이버 Maps 인증 비밀키
   - 파일명은 `.env`이며 `.env.txt`가 아닙니다. 기존 `.env`를 덮어쓰지 않습니다.
   - 실제 값은 GitHub·채팅·화면 코드에 넣지 않습니다. 서버의 같은 이름 환경변수로 제공해도 됩니다.

3. 추가 기능 서버를 실행합니다. 기존 8000번 서버와 동시에 시험할 수 있도록 8001번을 사용합니다.

   ```powershell
   .\.venv\update_v1\Scripts\python.exe -m uvicorn app_update_v1:app --host 127.0.0.1 --port 8001 --no-access-log
   ```

4. 같은 PC의 크롬에서 [update_v1 지도 열기](http://localhost:8001/)를 엽니다. 위치 권한을 허용하고 병원을 선택합니다.

터미널은 서버를 사용하는 동안 열어 둡니다. 종료는 `Ctrl+C`, 다음 실행은 3번 명령만 다시 입력합니다. HTML 파일을 더블클릭하거나 Python 파일 한 줄만 실행하면 서버가 열리는 방식은 아닙니다.

`--no-access-log`는 좌표가 포함된 요청 주소를 접속 로그에 남기지 않도록 하는 옵션입니다. macOS/Linux에서는 위 실행 파일 경로를 `.venv/update_v1/bin/python`으로 바꿉니다.

## 4. 외부 설정 확인

- 웹 지도는 `index_update_v1.html`의 공개 Client ID를 사용합니다. 서버 인증정보도 해당 Maps 애플리케이션과 맞춰야 합니다.
- 네이버 Maps에서 웹 지도와 Directions 5를 사용할 수 있어야 하며 실제 접속 주소가 Web 서비스 URL에 등록되어야 합니다.
- 위치 권한은 브라우저·운영체제에서 허용해야 합니다. 위치 확인에 실패하면 `내 위치` 버튼으로 재시도합니다.
- 휴대폰 테스트에는 휴대폰에서 접근할 수 있는 HTTPS 주소와 실행 중인 서버가 필요합니다. 휴대폰의 `localhost`는 PC가 아닙니다.
- 고정 HTTPS와 상시 서버 배포는 별도 작업입니다. 이 GitHub 주소 자체는 실행 중인 지도 주소가 아닙니다.

## 5. 추가 기능 확인 순서

1. 병원 23곳의 목록·핀과 기본정보가 보이는지 확인합니다. 없는 항목은 `확인 필요`, 좌표가 없는 기관은 목록에 `좌표 없음`으로 표시합니다.
2. 지도 준비 후 위치를 한 번 요청하고 빨간 현재 위치 점을 표시합니다.
3. 병원을 누르면 초록색으로 약 두 배 커진 병원 핀, 빨간 출발지 점, 초록 도로 경로가 함께 보입니다.
4. 경로 옆 검은 상자에 `약 N분`과 `N.Nkm`가 두 줄로 표시됩니다. 별도 길 안내 버튼은 없습니다.
5. 다른 병원을 누르면 경로·상자가 교체됩니다. `전체 보기`는 경로·상자를 지우고 전체 병원 핀을 복원합니다.

## 6. 코드와 변수 설명

팀장님 원본 파일은 `9f20743`의 내용을 복구했습니다. 새 버전은 원본을 복사하여 다음 연결만 추가한 별도 파일입니다.

- `map_update_v1.js`: 원본 `frontend/map.js`의 모든 줄·변수명을 유지하고 연결 코드와 한글 주석 12줄을 추가했습니다.
- `index_update_v1.html`: 원본 화면에 추가 기능 스크립트를 연결하고, update_v1 JavaScript 이름을 사용합니다.
- `app_update_v1.py`: 원래 병원 조회·길찾기 로직을 유지하면서 update_v1 화면·JSON을 읽습니다. 두 JavaScript 파일만 공개하며 `.env`·Python 소스는 웹으로 제공하지 않습니다.
- `hospital-route-view_update_v1.js`: 추가 동작을 모아 둔 파일입니다. 기존 거리 조회 응답의 `path`를 재사용하므로 경로 표시만을 위한 중복 API 호출은 추가하지 않습니다.

| 새 이름 | 뜻 |
| --- | --- |
| `selectedHospital` | 현재 선택한 병원 |
| `locationMarker` | 기존 빨간 현재 위치 점 |
| `routeLine` / `routeLabel` | 경로선 / 시간·거리 상자 |
| `hospitals` | 기관 ID별 병원 핀과 원래 모양 |
| `register` / `select` | 원본 핀 전달 / 선택 병원 변경 |
| `draw` | 받은 도로 좌표로 경로 표시 |
| `locationReset` / `locationReady` | 위치 재조회 시 정리 / 위치 확인 후 경로 조회 |
| `showAll` | 경로 정리와 전체 병원 핀 복원 |

## 7. 백업과 검증 범위

- 팀장님 원본은 기본 `main`과 복구된 원본 폴더에 보존합니다.
- 이번 복구 직전 작업본은 [backup-before-update-v1 브랜치](https://github.com/yunsung-yonsei/myailab/tree/backup-before-update-v1/medinavi)에 별도로 보존했습니다.
- 실제 `.env`·로그·가상환경은 업로드·백업 대상에서 제외했습니다. 빈 양식만 제공합니다.
- 파일 이름과 참조 경로, 병원 23개 JSON, 화면·정적 파일·병원 API, 비공개 파일 접근 차단을 검사합니다. 길찾기 응답 처리는 실제 인증정보를 열람하지 않고 모의 응답으로 검사합니다.
- 팀장님 PC에서의 실제 네이버 지도·길찾기·현재 위치 성공 여부는 4번 외부 설정과 권한까지 맞춘 후 확인해야 합니다.

병원 JSON은 저장 당시 정보이며 현재 수술·수용 가능 여부를 판단하지 않습니다. 경로는 `trafast` 옵션의 일반 자동차 기준 예상이며, 구급차 특례 주행이나 주행 중 자동 재탐색은 포함하지 않습니다.
