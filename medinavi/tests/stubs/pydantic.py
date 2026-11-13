"""시험용 pydantic 대역: 선언된 필드를 그대로 속성으로 담는다."""


class ValidationError(Exception):
    pass


def Field(**kwargs):
    return None


class BaseModel:
    def __init__(self, **values):
        for name in self.__annotations__:
            setattr(self, name, values[name])
