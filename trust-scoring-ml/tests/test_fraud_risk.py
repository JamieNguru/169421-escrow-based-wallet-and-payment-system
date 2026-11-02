import pandas as pd

from src.fraud_risk import build_dataset, compare


def _clients(n=60):
    return pd.DataFrame(
        {
            "client_id": range(n),
            "payment_completion_rate": [0.9 + 0.001 * (i % 50) for i in range(n)],
            "escrow_release_time_hours": [1.0 + i for i in range(n)],
            "refund_requests": [i % 5 for i in range(n)],
            "total_jobs_paid": [100 + i for i in range(n)],
        }
    )


def _rates(n=60):
    return pd.DataFrame(
        {"client_id": range(n), "real_fraud_rate": [i / 1000 for i in range(n)], "real_labeled_transactions": 100}
    )


def test_build_dataset_labels_top_third_by_real_fraud_rate():
    data = build_dataset(_clients(), _rates())

    assert data["high_fraud_risk"].sum() == 20
    assert data.loc[data["real_fraud_rate"] == data["real_fraud_rate"].max(), "high_fraud_risk"].item() == 1
    assert (data["refund_rate"] == data["refund_requests"] / data["total_jobs_paid"]).all()


def test_build_dataset_drops_clients_without_fraud_rates():
    data = build_dataset(_clients(60), _rates(40))

    assert len(data) == 40


def test_compare_scores_chance_for_majority_baseline():
    results = compare(build_dataset(_clients(), _rates()), n_repeats=1)

    assert results["always majority"][0] == 0.5
    assert set(results) == {"behaviour forest", "volume-only (logistic)", "always majority"}
