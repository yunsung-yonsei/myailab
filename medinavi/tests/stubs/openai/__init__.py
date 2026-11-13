"""시험용 OpenAI 대역: 시험이 output(dict)을 정해 주면 그 값으로 응답 모델을 만든다."""

output = {}
last = {}


class OpenAIError(Exception):
    pass


class _Responses:
    async def parse(self, *, model, instructions, input, text_format, store, max_output_tokens):
        last.update(model=model, instructions=instructions, input=input)

        class Result:
            output_parsed = text_format(**output)
        return Result()


class AsyncOpenAI:
    def __init__(self, *, api_key, timeout, max_retries):
        self.responses = _Responses()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass
