"""Synthetic request-traffic generator. THIS IS NOT REAL TRAFFIC.

A hand-designed mixture meant to resemble a typical JSON API, so the model learns that a request
with 0 request bytes (GET) is normal. Every parameter below is an assumption, not a measurement.
"""

from __future__ import annotations

import numpy as np

# Mixture weights (sum to 1) and (median, sigma) of log-normal distributions; bytes and milliseconds.
GET_FRACTION = 0.50
POST_FRACTION = 0.20
EMPTY_FRACTION = 0.15  # 204/304-style: 0-byte response, fast and widely spread latency
ERROR_FRACTION = 0.15  # 4xx/5xx-style: small JSON error body

GET_RESPONSE = (3000.0, 1.0)
GET_LATENCY = (60.0, 0.6)
POST_REQUEST = (800.0, 0.8)
POST_RESPONSE = (400.0, 0.7)
POST_LATENCY = (120.0, 0.6)
EMPTY_LATENCY = (30.0, 1.0)   # roughly 4 ms .. 200 ms within 2 sigma
ERROR_RESPONSE = (150.0, 0.6)
ERROR_LATENCY = (40.0, 1.0)


def _lognormal(rng: np.random.Generator, spec: tuple[float, float], n: int) -> np.ndarray:
    median, sigma = spec
    return rng.lognormal(mean=np.log(median), sigma=sigma, size=n)


def generate_traffic(n: int, seed: int = 42) -> np.ndarray:
    """Return an (n, 3) float array: requestByteSize, responseByteSize, latencyMs."""
    rng = np.random.default_rng(seed)
    u = rng.random(n)
    edges = np.cumsum([GET_FRACTION, POST_FRACTION, EMPTY_FRACTION])
    kind = np.searchsorted(edges, u)  # 0 GET, 1 POST, 2 empty, 3 error
    req = np.zeros(n)
    res = np.zeros(n)
    lat = np.zeros(n)

    def fill(k, request=None, response=None, latency=None):
        m = kind == k
        c = int(m.sum())
        if request:
            req[m] = _lognormal(rng, request, c)
        if response:
            res[m] = _lognormal(rng, response, c)
        lat[m] = _lognormal(rng, latency, c)

    fill(0, response=GET_RESPONSE, latency=GET_LATENCY)
    fill(1, request=POST_REQUEST, response=POST_RESPONSE, latency=POST_LATENCY)
    fill(2, latency=EMPTY_LATENCY)
    fill(3, response=ERROR_RESPONSE, latency=ERROR_LATENCY)
    # some DELETE/PUT-style empty and error responses carry small request bodies
    body = (kind >= 2) & (rng.random(n) < 0.3)
    req[body] = _lognormal(rng, (300.0, 0.8), int(body.sum()))

    X = np.column_stack((np.round(req), np.round(res), np.maximum(1.0, np.round(lat))))
    return X.astype(float)
