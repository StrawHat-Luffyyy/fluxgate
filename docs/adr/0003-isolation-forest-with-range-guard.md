# ADR 0003: Isolation Forest plus a range guard, trained on synthetic data

Status: accepted

## Context

The gateway wants to flag individual requests that look abnormal, on three features: request bytes, response bytes and latency. New deployments have no labelled incidents and no traffic history.

## Decision

Score with an unsupervised Isolation Forest, and explain each flag with SHAP so that an alert names the feature responsible.

Train on a documented synthetic mixture (`ai-service/synthetic.py`), because there is no real traffic to train on. The model is marked as synthetic in its version name.

Add a range guard: a value over ten times the largest seen in training is flagged whatever the forest says. This exists because an Isolation Forest stops separating points beyond its training range, so it scored an extreme outlier no higher than a mildly unusual request. For example, a 30 second latency was not flagged by the forest alone.

Models are versioned directories with a SHA-256 for each artifact, checked before loading, because joblib files execute code when loaded.

## Consequences

- No labels are needed, and the alert explains itself.
- The model has learned an assumption about traffic, not any tenant's actual traffic. Its false positive and false negative rates on real traffic are unknown. `ai-service/README.md` states this and gives the evaluation on synthetic data only.
- There is a known blind spot: latencies of roughly 2 to 14 seconds are flagged by neither detector.
- It scores requests one at a time, so it cannot see attacks that are only visible in aggregate, such as credential stuffing made of normal-looking requests.
- Traffic faster than the training range, like a localhost upstream at 1 to 2 ms, can look abnormal. The demo upstream adds a realistic delay for this reason.
- Per-tenant retraining on real traffic is the obvious next step, and would replace most of this ADR's assumptions.
