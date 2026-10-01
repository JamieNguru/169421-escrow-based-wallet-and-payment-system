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

One notebook per pipeline stage, following the proposal's Chapter 3. Run them in order: each saves what the next one loads.

| Notebook | Stage | Saves |
|---|---|---|
| [`01_data_acquisition`](notebooks/01_data_acquisition.ipynb) | Profiles the raw data (3.2.1) | — |
| [`02_data_preprocessing`](notebooks/02_data_preprocessing.ipynb) | Cleans amounts, flags failures, encodes channel, merges merchant categories (3.2.2) | `data/processed/transactions_clean.parquet` |
| [`03_feature_engineering`](notebooks/03_feature_engineering.ipynb) | Per-user aggregation, synthetic worker/client split, trust labels (3.2.2) | `data/processed/{worker,client}_features.csv` |
| [`04_model_training`](notebooks/04_model_training.ipynb) | Cross-validated tuning of trees and depth, final training (3.2.3) | `models/*.joblib`, tuning heatmaps |
| [`05_model_evaluation`](notebooks/05_model_evaluation.ipynb) | Test-set metrics, real-fraud validation, report figures (3.2.4) | `reports/figures/*.png` |
| [`06_prediction_and_deployment`](notebooks/06_prediction_and_deployment.ipynb) | `predict_trust` and the Flask `/score` endpoint | — |

Run locally with `jupyter lab` from this directory after activating the virtual environment. Each notebook also runs in Google Colab: its first cell mounts Google Drive, copies this repo's code from the `dev` branch, and reads raw data from the Drive root (outputs go to `My Drive/processed` and `My Drive/models`).

## Pipeline (`src/`)

- `preprocessing.py` / `feature_engineering.py` — cleaning, per-user aggregation, synthetic worker/client datasets, trust labels.
- `train.py` — train/test split, cross-validated hyperparameter tuning, and training. `python -m src.train` tunes both models and saves them.
- `evaluate.py` — accuracy, precision, recall, F1, ROC-AUC on the held-out test set. `python -m src.evaluate` scores the saved models.
- `external_validation.py` — checks trust levels against real fraud labels.
- `generate_figures.py` / `plots.py` — report figures. `python -m src.generate_figures` regenerates them from the saved models.
- `predict.py` — inference wrapper used by `app.py`; loads the correct model based on the requesting user's role.

## API

`python app.py` serves `GET /health` and `POST /score` (body: `{"role": "worker" | "client", "features": {...}}`), returning the trust level and per-level probabilities.
