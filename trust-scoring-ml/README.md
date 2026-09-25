# Trust Scoring ML Microservice

Two Random Forest classifiers — one for workers, one for clients — that score platform users into Low/Medium/High trust levels based on their transaction history, served through a single role-aware Flask microservice for the escrow wallet backend.

Workers are assessed on job completion rate, dispute frequency, and response time. Clients are assessed on payment completion, escrow release time, and refund/dispute history.

## Setup

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Data

Raw datasets are not committed to the repo (see `.gitignore`). Place them locally under `data/`:

- `transactions_data.csv`
- `users_data.csv`
- `cards_data.csv`
- `mcc_codes.json`
- `train_fraud_labels.json`

## Notebooks

- [`notebooks/01_dataset_exploration.ipynb`](notebooks/01_dataset_exploration.ipynb) — loads and profiles the raw datasets.
- [`notebooks/02_feature_engineering.ipynb`](notebooks/02_feature_engineering.ipynb) — cleans and engineers features, split into separate worker and client datasets.

Run with `jupyter lab` from this directory after activating the virtual environment.

## Pipeline (`src/`)

- `preprocessing.py` / `feature_engineering.py` — reusable feature pipeline for both the worker and client datasets, ported from the notebooks.
- `train.py` — trains the worker and client Random Forest models.
- `evaluate.py` — computes precision/recall/F1/ROC-AUC separately for each model.
- `predict.py` — inference wrapper used by `app.py`; loads the correct model based on the requesting user's role.

## API

Once `app.py` is implemented: `POST /score` returns a trust classification for a given user, applying the worker or client model depending on their role. See [Issues](../../../issues) for current build status.
