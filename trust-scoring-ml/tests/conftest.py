import numpy as np
import pandas as pd
import pytest

N_ROWS = 60


@pytest.fixture
def worker_dataset():
    rng = np.random.default_rng(0)
    total_jobs = rng.integers(500, 20000, N_ROWS)
    return pd.DataFrame(
        {
            "client_id": range(N_ROWS),
            "job_completion_rate": rng.uniform(0.9, 1.0, N_ROWS),
            "dispute_count": (total_jobs * rng.uniform(0.0, 0.05, N_ROWS)).astype(int),
            "response_time_hours": rng.uniform(1, 30, N_ROWS),
            "total_jobs": total_jobs,
        }
    )


@pytest.fixture
def client_dataset():
    rng = np.random.default_rng(1)
    total_jobs_paid = rng.integers(500, 20000, N_ROWS)
    return pd.DataFrame(
        {
            "client_id": range(N_ROWS),
            "payment_completion_rate": rng.uniform(0.9, 1.0, N_ROWS),
            "escrow_release_time_hours": rng.uniform(1, 30, N_ROWS),
            "refund_requests": (total_jobs_paid * rng.uniform(0.0, 0.05, N_ROWS)).astype(int),
            "total_jobs_paid": total_jobs_paid,
        }
    )
