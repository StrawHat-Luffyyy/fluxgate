"""Synthetic request-traffic generator. THIS IS NOT REAL TRAFFIC.

A hand-designed mixture meant to resemble a typical JSON API, so the model learns that a request
with 0 request bytes (GET) is normal. Every parameter below is an assumption, not a measurement.
"""

from __future__ import annotations

import numpy as np

GET_FRACTION = 0.70
# (median, sigma) of log-normal distributions; units are bytes and milliseconds.
GET_RESPONSE = (3000.0, 1.0)
GET_LATENCY = (60.0, 0.5)
POST_REQUEST = (800.0, 0.8)
POST_RESPONSE = (400.0, 0.7)
POST_LATENCY = (120.0, 0.5)


def _lognormal(rng: np.random.Generator, spec: tuple[float, float], n: int) -> np.ndarray:
    median, sigma = spec
    return rng.lognormal(mean=np.log(median), sigma=sigma, size=n)


def generate_traffic(n: int, seed: int = 42) -> np.ndarray:
    """Return an (n, 3) float array: requestByteSize, responseByteSize, latencyMs."""
    rng = np.random.default_rng(seed)
    is_get = rng.random(n) < GET_FRACTION
    n_get = int(is_get.sum())
    n_post = n - n_get

    req = np.zeros(n)
    res = np.zeros(n)
    lat = np.zeros(n)
    req[~is_get] = _lognormal(rng, POST_REQUEST, n_post)
    res[is_get] = _lognormal(rng, GET_RESPONSE, n_get)
    res[~is_get] = _lognormal(rng, POST_RESPONSE, n_post)
    lat[is_get] = _lognormal(rng, GET_LATENCY, n_get)
    lat[~is_get] = _lognormal(rng, POST_LATENCY, n_post)

    X = np.column_stack((np.round(req), np.round(res), np.maximum(1.0, np.round(lat))))
    return X.astype(float)
