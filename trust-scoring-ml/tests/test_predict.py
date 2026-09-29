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
    result = predict_trust(
        "worker", {"job_completion_rate": 0.97, "dispute_rate": 0.01, "response_time_hours": 8.0}
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

    assert predict_trust("worker", {**features, "unused": 123}) == predict_trust("worker", features)


def test_predict_trust_rejects_unknown_role(trained_models):
    with pytest.raises(ValueError, match="Unknown role"):
        predict_trust("admin", {})


def test_predict_trust_rejects_missing_features(trained_models):
    with pytest.raises(ValueError, match="dispute_rate"):
        predict_trust("worker", {"job_completion_rate": 0.97, "response_time_hours": 8.0})
