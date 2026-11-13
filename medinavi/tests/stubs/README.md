# 시험용 가짜 모듈

`tests/test_server.py`가 실제 네트워크와 외부 서비스 없이 `app.py`를 시험할 수 있도록,
FastAPI·httpx·OpenAI·pydantic·python-dotenv의 아주 작은 대역을 둡니다.
실제 패키지로 서버가 켜지는지는 GitHub Actions의 "Server starts" 단계가 따로 확인합니다.
