import numpy as np
import pandas as pd

from src.time_split_validation import build_dataset, evaluate, expected_scores, past_features


def _transactions(client, dates, funds_errors=0, credential_errors=0):
    n = len(dates)
    return pd.DataFrame(
        {
            "id": np.arange(n),
            "client_id": client,
            "date": pd.to_datetime(dates),
            "amount": 10.0,
            "has_error": 0,
            "funds_error": [1] * funds_errors + [0] * (n - funds_errors),
            "credential_error": [1] * credential_errors + [0] * (n - credential_errors),
        }
    )


def test_past_features_ignore_transactions_on_or_after_the_cutoff():
    early = _transactions(1, ["2016-01-01", "2016-06-01", "2016-12-31"])
    late = _transactions(1, ["2017-01-01", "2018-01-01"], funds_errors=2, credential_errors=2)

    features = past_features(pd.concat([early, late]), "2017-01-01").iloc[0]

    assert features["total_jobs"] == 3
    assert features["job_completion_rate"] == 1.0
    assert features["dispute_rate"] == 0.0


def test_past_features_cover_both_roles_for_every_client_and_fix_overrun_at_zero():
    tx = pd.concat([_transactions(1, ["2016-01-01", "2016-01-02"]), _transactions(2, ["2016-01-01", "2016-02-01"])])

    features = past_features(tx, "2017-01-01")

    assert list(features["client_id"]) == [1, 2]
    assert (features["delivery_overrun"] == 0).all()
    assert {"payment_completion_rate", "refund_rate", "escrow_release_time_hours"} <= set(features.columns)


def test_past_features_drop_clients_with_no_history_before_the_cutoff():
    tx = pd.concat([_transactions(1, ["2016-01-01", "2016-01-02"]), _transactions(2, ["2018-01-01", "2018-01-02"])])

    assert list(past_features(tx, "2017-01-01")["client_id"]) == [1]


def _features(ids):
    return pd.DataFrame({"client_id": ids, "total_jobs": 100})


def _rates(ids, rates, labelled=500):
    return pd.DataFrame({"client_id": ids, "future_fraud_rate": rates, "future_labeled_transactions": labelled})


def test_build_dataset_labels_above_median_future_fraud_rate_as_high_risk():
    data = build_dataset(_features([1, 2, 3, 4]), _rates([1, 2, 3, 4], [0.1, 0.2, 0.3, 0.4]), min_future=1)

    assert list(data["high_risk"]) == [0, 0, 1, 1]


def test_build_dataset_drops_clients_without_enough_future_labels():
    rates = pd.concat([_rates([1, 2], [0.1, 0.2]), _rates([3], [0.9], labelled=5)])

    data = build_dataset(_features([1, 2, 3]), rates, min_future=100)

    assert list(data["client_id"]) == [1, 2]


def test_expected_scores_weight_level_probabilities():
    class Model:
        classes_ = np.array(["High", "Low", "Medium"])

        def predict_proba(self, X):
            return np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])

    scores = expected_scores(Model(), pd.DataFrame({"a": [1, 2, 3]}))

    assert list(scores) == [1.0, 0.0, 0.5]  # High, Low, Medium on a 0-1 scale


def test_evaluate_rewards_low_scores_for_high_fraud_clients():
    rates = np.linspace(0.01, 0.5, 40)
    data = pd.DataFrame(
        {"future_fraud_rate": rates, "high_risk": (rates > np.median(rates)).astype(int), "total_jobs": np.random.default_rng(0).permutation(40) + 1}
    )

    good = evaluate(data, pd.Series(-rates))
    bad = evaluate(data, pd.Series(rates))

    assert good["auc"] == 1.0 and good["spearman"] < -0.99
    assert bad["auc"] == 0.0 and bad["spearman"] > 0.99
