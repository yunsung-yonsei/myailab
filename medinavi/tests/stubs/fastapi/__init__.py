"""시험용 FastAPI 대역: 라우트 함수를 경로별로 모아 시험에서 직접 부를 수 있게 한다."""


class HTTPException(Exception):
    def __init__(self, status_code, detail=None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class Request:
    pass


def Query(*args, **kwargs):
    return None


class FastAPI:
    def __init__(self):
        self.routes = {}

    def mount(self, *args, **kwargs):
        pass

    def _route(self, path, **kwargs):
        def decorator(function):
            if "response_model" in kwargs:
                assert isinstance(kwargs["response_model"], type), "response_model 이름이 잘못됐어요"
            self.routes[path] = function
            return function
        return decorator

    def get(self, path, **kwargs):
        return self._route(path, **kwargs)

    def post(self, path, **kwargs):
        return self._route(path, **kwargs)
