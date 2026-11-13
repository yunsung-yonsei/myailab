"""시험용 httpx 대역: 시험이 handler(url, headers, params) -> (상태코드, 본문)를 정해 준다."""

handler = None
calls = []


class TimeoutException(Exception):
    pass


class RequestError(Exception):
    pass


class Response:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body
        self.content = body.encode("utf-8") if isinstance(body, str) else b""

    def json(self):
        if isinstance(self._body, str):
            raise ValueError("JSON이 아님")
        return self._body


class AsyncClient:
    def __init__(self, timeout=None):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def get(self, url, headers=None, params=None):
        calls.append((url, headers, params))
        status, body = handler(url, headers or {}, params or {})
        return Response(status, body)
