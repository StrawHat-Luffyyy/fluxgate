import json
import logging
import threading

from confluent_kafka import KafkaError

from consumer import Outcome, run_loop
from health import HealthState
from jsonlog import JsonFormatter


class Err:
    def __init__(self, code, fatal=False):
        self._c, self._f = code, fatal

    def code(self): return self._c
    def fatal(self): return self._f
    def __str__(self): return "err"


class Msg:
    def __init__(self, err=None, offset=3):
        self._e, self._o = err, offset

    def error(self): return self._e
    def topic(self): return "t"
    def partition(self): return 0
    def offset(self): return self._o


class FakeConsumer:
    def __init__(self, items, stop):
        self.items, self.stop = list(items), stop
        self.commits, self.seeks = [], []

    def poll(self, timeout):
        if not self.items:
            self.stop.set()
            return None
        return self.items.pop(0)

    def commit(self, message=None, asynchronous=True):
        assert asynchronous is False
        self.commits.append(message.offset())

    def seek(self, tp):
        self.seeks.append(tp.offset)


class FakeProcessor:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)

    def handle(self, msg):
        return self.outcomes.pop(0)


def test_commit_seek_and_eof(monkeypatch):
    stop = threading.Event()
    stop.wait = lambda t=None: None  # no real sleeping
    c = FakeConsumer([Msg(offset=1), Msg(Err(KafkaError._PARTITION_EOF)), Msg(offset=2), Msg(Err(KafkaError._TRANSPORT))], stop)
    health = HealthState("v")
    code = run_loop(c, FakeProcessor([Outcome.COMMIT, Outcome.RETRY]), health, stop, KafkaError)
    assert code == 0 and c.commits == [1] and c.seeks == [2]
    assert health.started and not health.fatal


def test_fatal_error_exits_nonzero():
    stop = threading.Event()
    c = FakeConsumer([Msg(Err(KafkaError._FATAL, fatal=True))], stop)
    health = HealthState("v")
    assert run_loop(c, FakeProcessor([]), health, stop, KafkaError) == 1
    assert health.snapshot()[0] == 503


def test_json_formatter_valid_with_quotes_and_extras():
    rec = logging.LogRecord("n", logging.INFO, "f", 1, 'he said "hi" \\ ok', (), None)
    rec.requestId = "r-1"
    out = json.loads(JsonFormatter().format(rec))
    assert out["message"] == 'he said "hi" \\ ok' and out["requestId"] == "r-1" and out["level"] == "INFO"
