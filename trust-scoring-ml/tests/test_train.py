from sklearn.ensemble import RandomForestClassifier

from src.feature_engineering import TRUST_LEVELS
from src.train import (
    CLIENT_FEATURE_COLUMNS,
    WORKER_FEATURE_COLUMNS,
    split_client_dataset,
    split_worker_dataset,
    train_client_model,
    train_worker_model,
    tune_worker_model,
)

SMALL_GRID = {"n_estimators": [10, 20], "max_depth": [2, None]}


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


def test_split_functions_rebuild_the_training_test_set(worker_dataset, client_dataset):
    # Evaluation relies on rebuilding exactly the test set the model never saw in training.
    _, _, worker_X_test, _, _ = train_worker_model(worker_dataset)
    _, _, client_X_test, _, _ = train_client_model(client_dataset)

    assert split_worker_dataset(worker_dataset)[1].equals(worker_X_test)
    assert split_client_dataset(client_dataset)[1].equals(client_X_test)


def test_params_are_passed_to_the_forest(worker_dataset):
    model, _, _, _, _ = train_worker_model(worker_dataset, params={"n_estimators": 10, "max_depth": 3})

    assert model.n_estimators == 10
    assert model.max_depth == 3


def test_tuning_picks_from_the_grid_and_refits_on_the_training_split_only(worker_dataset):
    search = tune_worker_model(worker_dataset, param_grid=SMALL_GRID, cv=2)
    X_train, X_test, _, _ = split_worker_dataset(worker_dataset)

    assert search.best_params_["n_estimators"] in SMALL_GRID["n_estimators"]
    assert search.best_params_["max_depth"] in SMALL_GRID["max_depth"]
    assert len(search.cv_results_["params"]) == 4
    assert search.n_splits_ == 2
    # The final model is refit on the 48 training rows only; the 12 test rows stay unseen.
    # Each bootstrapped tree draws exactly as many samples as it was fit on.
    assert len(X_train) == 48 and len(X_test) == 12
    for tree in search.best_estimator_.estimators_:
        assert tree.tree_.weighted_n_node_samples[0] == len(X_train)
