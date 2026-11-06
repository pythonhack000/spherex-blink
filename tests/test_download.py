import httpx

from backend.archive import _retry_delay


def test_retry_delay_honours_retry_after_header():
    response = httpx.Response(503, headers={"Retry-After": "5"})
    assert 5 <= _retry_delay(response, 0) <= 7


def test_retry_delay_backs_off_without_a_response():
    assert 4 <= _retry_delay(None, 2) <= 6
