from backend.archive import Exposure
from backend.jobs import sample_evenly


def make(detector, count):
    return [Exposure(f"o{detector}_{i}", detector, 60000.0 + i, 1.0, 2.0, "u", "c") for i in range(count)]


def test_short_lists_are_left_alone():
    items = make(1, 5)
    assert sample_evenly(items, 10) == items


def test_every_array_gets_a_fair_share_even_when_one_dominates():
    chosen = sample_evenly(make(1, 500) + make(2, 20) + make(3, 20), 30)
    counts = {d: sum(item.detector == d for item in chosen) for d in (1, 2, 3)}
    assert counts == {1: 10, 2: 10, 3: 10}


def test_unused_share_of_a_small_array_passes_to_the_others():
    chosen = sample_evenly(make(1, 2) + make(2, 100), 30)
    assert len(chosen) == 30


def test_sample_spans_the_whole_time_range():
    chosen = sample_evenly(make(1, 100), 10)
    assert chosen[0].mjd == 60000.0
    assert chosen[-1].mjd == 60099.0
    assert [item.mjd for item in chosen] == sorted(item.mjd for item in chosen)
