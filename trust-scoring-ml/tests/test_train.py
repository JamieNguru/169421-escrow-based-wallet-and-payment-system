from sklearn.ensemble import RandomForestClassifier

from src.feature_engineering import TRUST_LEVELS
from src.train import CLIENT_FEATURE_COLUMNS, WORKER_FEATURE_COLUMNS, train_client_model, train_worker_model


def test_train_worker_model_uses_rate_features_and_stratified_split(worker_dataset):
    model, X_train, X_test, y_train, y_test = train_worker_model(worker_dataset)

    assert isinstance(model, RandomForestClassifier)
    assert list(X_train.columns) == WORKER_FEATURE_COLUMNS
    assert list(X_test.columns) == WORKER_FEATURE_COLUMNS
    assert len(X_test) == 12
    assert set(model.classes_) == set(TRUST_LEVELS)
    assert y_test.value_counts().to_dict() == {level: 4 for level in TRUST_LEVELS}


def test_train_client_model_uses_rate_features_and_stratified_split(client_dataset):
    model, X_train, X_test, y_train, y_test = train_client_model(client_dataset)

    assert isinstance(model, RandomForestClassifier)
    assert list(X_train.columns) == CLIENT_FEATURE_COLUMNS
    assert list(X_test.columns) == CLIENT_FEATURE_COLUMNS
    assert len(X_test) == 12
    assert set(model.classes_) == set(TRUST_LEVELS)
    assert y_test.value_counts().to_dict() == {level: 4 for level in TRUST_LEVELS}


def test_worker_features_exclude_raw_count_and_volume(worker_dataset):
    _, X_train, _, _, _ = train_worker_model(worker_dataset)

    assert "dispute_count" not in X_train.columns
    assert "total_jobs" not in X_train.columns


def test_client_features_exclude_raw_count_and_volume(client_dataset):
    _, X_train, _, _, _ = train_client_model(client_dataset)

    assert "refund_requests" not in X_train.columns
    assert "total_jobs_paid" not in X_train.columns


def test_training_is_reproducible_with_same_random_state(worker_dataset):
    model_a, _, X_test, _, _ = train_worker_model(worker_dataset, random_state=7)
    model_b, _, _, _, _ = train_worker_model(worker_dataset, random_state=7)

    assert (model_a.predict_proba(X_test) == model_b.predict_proba(X_test)).all()
