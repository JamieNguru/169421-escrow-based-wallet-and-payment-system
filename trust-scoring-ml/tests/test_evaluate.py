import pytest

from src.evaluate import evaluate_model
from src.train import train_client_model, train_worker_model

METRIC_KEYS = {"accuracy", "precision", "recall", "f1", "roc_auc"}


@pytest.mark.parametrize("trainer, fixture_name", [(train_worker_model, "worker_dataset"), (train_client_model, "client_dataset")])
def test_evaluate_model_returns_all_metrics_in_unit_range(trainer, fixture_name, request):
    model, _, X_test, _, y_test = trainer(request.getfixturevalue(fixture_name))

    metrics = evaluate_model(model, X_test, y_test)

    assert set(metrics) == METRIC_KEYS
    for name, value in metrics.items():
        assert 0.0 <= value <= 1.0, name


def test_evaluate_model_accuracy_matches_model_score(worker_dataset):
    model, _, X_test, _, y_test = train_worker_model(worker_dataset)

    metrics = evaluate_model(model, X_test, y_test)

    assert metrics["accuracy"] == model.score(X_test, y_test)
