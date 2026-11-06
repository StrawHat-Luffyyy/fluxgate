import pytest
from sklearn.ensemble import IsolationForest

from scoring import Scorer, to_model_space
from synthetic import generate_traffic


@pytest.fixture(scope="session")
def trained():
    X = generate_traffic(3000, seed=1)
    model = IsolationForest(n_estimators=50, contamination=0.01, random_state=1).fit(to_model_space(X))
    fmax = {"requestByteSize": X[:, 0].max(), "responseByteSize": X[:, 1].max(), "latencyMs": X[:, 2].max()}
    return model, X[:100], fmax


@pytest.fixture(scope="session")
def scorer(trained):
    model, baseline, fmax = trained
    return Scorer(model, baseline, "vtest", fmax)


def good_message(**over):
    msg = {
        "requestId": "r-1", "tenantId": "t-1", "apiKeyId": "k", "method": "GET", "path": "/x",
        "routePrefix": "/x", "clientIp": "1.2.3.4", "requestByteSize": 0, "responseByteSize": 3000,
        "statusCode": 200, "latencyMs": 60, "rateLimited": False, "timestamp": 1700000000000,
    }
    msg.update(over)
    return msg
