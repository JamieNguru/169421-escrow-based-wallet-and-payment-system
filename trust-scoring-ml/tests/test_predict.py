import pytest

import src.predict as predict_module
from src.feature_engineering import TRUST_LEVELS
from src.model_io import load_model, save_model
from src.predict import predict_trust
from src.train import train_client_model, train_worker_model


@pytest.fixture
def trained_models(worker_dataset, client_dataset, monkeypatch):
    models = {
        "worker": train_worker_model(worker_dataset)[0],
        "client": train_client_model(client_dataset)[0],
    }
    monkeypatch.setattr(predict_module, "load_model", lambda role, version: models[role])
    return models


def test_save_and_load_model_round_trip(worker_dataset, tmp_path):
    model, _, X_test, _, _ = train_worker_model(worker_dataset)

    path = save_model(model, "worker", "test", models_dir=tmp_path)
    reloaded = load_model("worker", "test", models_dir=tmp_path)

    assert path.name == "worker_trust_model_test.joblib"
    assert (reloaded.predict(X_test) == model.predict(X_test)).all()


def test_predict_trust_worker_returns_level_and_probabilities(trained_models):
    # The fixture trains v1-style worker models, which are timed on response hours.
    result = predict_trust(
        "worker", {"job_completion_rate": 0.97, "dispute_rate": 0.01, "response_time_hours": 8.0}, version="v1"
    )

    assert result["role"] == "worker"
    assert result["trust_level"] in TRUST_LEVELS
    assert set(result["probabilities"]) == set(TRUST_LEVELS)
    assert sum(result["probabilities"].values()) == pytest.approx(1.0)


def test_predict_trust_client_returns_level_and_probabilities(trained_models):
    result = predict_trust(
        "client", {"payment_completion_rate": 0.95, "refund_rate": 0.02, "escrow_release_time_hours": 12.0}
    )

    assert result["role"] == "client"
    assert result["trust_level"] in TRUST_LEVELS
    assert sum(result["probabilities"].values()) == pytest.approx(1.0)


def test_predict_trust_ignores_extra_features(trained_models):
    features = {"job_completion_rate": 0.97, "dispute_rate": 0.01, "response_time_hours": 8.0}

    assert predict_trust("worker", {**features, "unused": 123}, version="v1") == predict_trust(
        "worker", features, version="v1"
    )


def test_predict_trust_workers_are_timed_on_delivery_overrun(trained_models):
    # v2 asks for the overrun, not the response hours v1 used.
    with pytest.raises(ValueError, match="delivery_overrun"):
        predict_trust("worker", {"job_completion_rate": 0.97, "dispute_rate": 0.01, "response_time_hours": 8.0})


def test_predict_trust_rejects_unknown_role(trained_models):
    with pytest.raises(ValueError, match="Unknown role"):
        predict_trust("admin", {})


def test_predict_trust_rejects_missing_features(trained_models):
    with pytest.raises(ValueError, match="dispute_rate"):
        predict_trust("worker", {"job_completion_rate": 0.97, "response_time_hours": 8.0})


@pytest.mark.parametrize(
    "features",
    [
        {"payment_completion_rate": 3.0, "refund_rate": 0.02, "escrow_release_time_hours": 12.0},
        {"payment_completion_rate": 0.9, "refund_rate": -0.1, "escrow_release_time_hours": 12.0},
        {"payment_completion_rate": 0.9, "refund_rate": 0.02, "escrow_release_time_hours": -1.0},
        {"payment_completion_rate": "high", "refund_rate": 0.02, "escrow_release_time_hours": 12.0},
    ],
)
def test_predict_trust_rejects_out_of_range_features(trained_models, features):
    with pytest.raises(ValueError):
        predict_trust("client", features)


def test_load_model_caches_until_the_file_changes(worker_dataset, tmp_path):
    import os

    model = train_worker_model(worker_dataset)[0]
    save_model(model, "worker", "cache", models_dir=tmp_path)

    first = load_model("worker", "cache", models_dir=tmp_path)
    assert load_model("worker", "cache", models_dir=tmp_path) is first

    path = save_model(model, "worker", "cache", models_dir=tmp_path)
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
    assert load_model("worker", "cache", models_dir=tmp_path) is not first


def test_load_model_still_raises_for_a_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_model("worker", "nope", models_dir=tmp_path)
