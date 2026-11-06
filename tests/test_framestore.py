import numpy as np

from backend import config, framestore
from backend.framestore import Frame


def make_frame():
    pixels = np.array([[1.5, np.nan], [3.0, 4.0]], np.float32)
    mask = np.array([[0, 1], [0, 0]], np.uint8)
    return Frame({"obsId": "o1", "detector": 2, "mjd": 61000.5, "visit": 1}, pixels, mask)


def test_saved_frame_comes_back_unchanged(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    framestore.save("job", "key", make_frame())
    loaded = framestore.load("job", "key", visit=7)
    assert loaded.meta["detector"] == 2
    assert np.array_equal(loaded.pixels, make_frame().pixels, equal_nan=True)
    assert loaded.mask.tolist() == [[0, 1], [0, 0]]


def test_visit_comes_from_the_current_job_not_the_stored_file(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    framestore.save("job", "key", make_frame())
    assert framestore.load("job", "key", visit=7).meta["visit"] == 7


def test_missing_frame_is_none(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    assert framestore.load("job", "absent", visit=0) is None


def test_corrupt_frame_is_treated_as_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    framestore.path_for("job", "bad").parent.mkdir(parents=True)
    framestore.path_for("job", "bad").write_bytes(b"not a frame")
    assert framestore.load("job", "bad", visit=0) is None
