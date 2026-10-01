import pandas as pd
import pytest

from src.feature_engineering import (
    add_time_features,
    aggregate_client_behavior,
    assign_synthetic_roles,
    build_client_dataset,
    build_worker_and_client_datasets,
    build_worker_dataset,
)


def test_add_time_features_derives_hour_day_month_and_weekend():
    df = pd.DataFrame(
        {"date": pd.to_datetime(["2026-01-03 14:30:00", "2026-01-05 09:00:00"])}
    )  # Jan 3 2026 is a Saturday, Jan 5 2026 is a Monday

    result = add_time_features(df)

    assert result["hour"].tolist() == [14, 9]
    assert result["month"].tolist() == [1, 1]
    assert result["day_of_week"].tolist() == [5, 0]
    assert result["is_weekend"].tolist() == [1, 0]


def test_aggregate_client_behavior_computes_expected_stats():
    transactions = pd.DataFrame(
        {
            "id": [1, 2, 3, 4],
            "client_id": [100, 100, 100, 200],
            "date": pd.to_datetime(
                [
                    "2020-01-01 00:00:00",
                    "2020-01-01 02:00:00",
                    "2020-01-01 06:00:00",
                    "2020-01-02 00:00:00",
                ]
            ),
            "amount": [10.0, 20.0, 30.0, 5.0],
            "has_error": [0, 1, 1, 0],
            "funds_error": [0, 1, 0, 0],
            "credential_error": [0, 0, 1, 0],
        }
    )

    result = aggregate_client_behavior(transactions).set_index("client_id")

    client_100 = result.loc[100]
    assert client_100["transaction_count"] == 3
    assert client_100["total_amount"] == 60.0
    assert client_100["avg_amount"] == 20.0
    assert client_100["error_count"] == 2
    assert client_100["funds_error_count"] == 1
    assert client_100["credential_error_count"] == 1
    assert client_100["avg_hours_between_transactions"] == 3.0
    assert client_100["error_rate"] == 2 / 3
    assert client_100["funds_error_rate"] == 1 / 3
    assert client_100["credential_error_rate"] == 1 / 3

    # Client 200 has a single transaction, so its own avg_hours is NaN before the
    # median fill; the fill should use client 100's avg (3.0), the only other value.
    client_200 = result.loc[200]
    assert client_200["transaction_count"] == 1
    assert client_200["error_count"] == 0
    assert client_200["error_rate"] == 0.0
    assert client_200["avg_hours_between_transactions"] == 3.0


def test_assign_synthetic_roles_is_reproducible_with_same_seed():
    client_agg = pd.DataFrame({"client_id": range(20)})

    first = assign_synthetic_roles(client_agg, seed=42)
    second = assign_synthetic_roles(client_agg, seed=42)

    assert first["role"].tolist() == second["role"].tolist()
    assert set(first["role"].unique()) <= {"worker", "client"}


def test_build_worker_dataset_derives_proxy_features():
    client_agg = pd.DataFrame(
        {
            "client_id": [1, 2],
            "transaction_count": [10, 20],
            "error_count": [3, 6],
            "error_rate": [0.3, 0.3],
            "funds_error_rate": [0.05, 0.1],
            "credential_error_count": [2, 3],
            "avg_hours_between_transactions": [5.0, 8.0],
            "role": ["worker", "client"],
        }
    )

    result = build_worker_dataset(client_agg)

    # Completion comes from insufficient-balance errors and disputes from credential errors,
    # not from the overall error rate.
    assert result["client_id"].tolist() == [1]
    assert result["job_completion_rate"].iloc[0] == pytest.approx(0.95)
    assert result["dispute_count"].iloc[0] == 2
    assert result["response_time_hours"].iloc[0] == 5.0
    assert result["total_jobs"].iloc[0] == 10


def test_build_client_dataset_derives_proxy_features():
    client_agg = pd.DataFrame(
        {
            "client_id": [1, 2],
            "transaction_count": [10, 20],
            "error_count": [3, 6],
            "error_rate": [0.3, 0.3],
            "funds_error_rate": [0.05, 0.1],
            "credential_error_count": [2, 3],
            "avg_hours_between_transactions": [5.0, 8.0],
            "role": ["worker", "client"],
        }
    )

    result = build_client_dataset(client_agg)

    assert result["client_id"].tolist() == [2]
    assert result["payment_completion_rate"].iloc[0] == pytest.approx(0.9)
    assert result["escrow_release_time_hours"].iloc[0] == 8.0
    assert result["refund_requests"].iloc[0] == 3
    assert result["total_jobs_paid"].iloc[0] == 20


def test_build_worker_and_client_datasets_covers_every_client_exactly_once():
    n_clients = 30
    rows = []
    row_id = 0
    for client_id in range(n_clients):
        for day in range(5):
            row_id += 1
            rows.append(
                {
                    "id": row_id,
                    "client_id": client_id,
                    "date": pd.Timestamp("2026-01-01") + pd.Timedelta(days=day, hours=client_id),
                    "amount": 10.0 + client_id,
                    "has_error": 0,
                    "funds_error": 0,
                    "credential_error": 0,
                }
            )
    transactions = pd.DataFrame(rows)

    worker_dataset, client_dataset = build_worker_and_client_datasets(transactions, seed=42)

    assert len(worker_dataset) + len(client_dataset) == n_clients
    assert set(worker_dataset["client_id"]).isdisjoint(set(client_dataset["client_id"]))
    assert list(worker_dataset.columns) == [
        "client_id",
        "job_completion_rate",
        "dispute_count",
        "response_time_hours",
        "total_jobs",
    ]
    assert list(client_dataset.columns) == [
        "client_id",
        "payment_completion_rate",
        "escrow_release_time_hours",
        "refund_requests",
        "total_jobs_paid",
    ]


def test_completion_and_dispute_rates_are_independent():
    # Regression test: these used to be 1 - x and x of the same failure rate, so always summed to 1.
    transactions = pd.DataFrame(
        {
            "id": range(1, 11),
            "client_id": [7] * 10,
            "date": pd.date_range("2026-01-01", periods=10, freq="h"),
            "amount": [10.0] * 10,
            "has_error": [1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
            "funds_error": [1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
            "credential_error": [0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
        }
    )
    client_agg = aggregate_client_behavior(transactions).assign(role="worker")

    worker = build_worker_dataset(client_agg).iloc[0]
    dispute_rate = worker["dispute_count"] / worker["total_jobs"]

    assert worker["job_completion_rate"] == pytest.approx(0.8)
    assert dispute_rate == pytest.approx(0.1)
    assert worker["job_completion_rate"] + dispute_rate != pytest.approx(1.0)
