# Escrow-Based Wallet and Payment System

An escrow-based wallet and payment simulation system with Random Forest-powered trust scoring for digital labour platforms in East Africa. Capstone project by Jamie Nguru Kibanya, BSc Informatics and Computer Science, Strathmore University, supervised by Mr. James Njihia.

## Problem

Digital labour platforms in East Africa rely on informal mobile-money transfers with no escrow, no dispute resolution, and no reliable trust signal, so clients risk paying for undelivered work, and workers risk non-payment.

## Solution

1. An escrow-based wallet and payment simulation: funds are held in escrow, released on confirmed job completion, refunded on disputes, with M-Pesa Daraja API (sandbox) integration for funding and withdrawals, multi-currency display (KES, UGX, TZS, USD), worker identity verification (KYC), tax-PIN compliance and terms-of-service acceptance.
2. Two Random Forest trust-scoring models (one for workers, one for clients) that classify users into Low/Medium/High trust based on their transaction history, served through a single role-aware Flask microservice.

## Architecture

- **Backend**: Node.js + Express, Firebase Firestore
- **Trust-scoring microservice**: Python, scikit-learn Random Forest (separate worker and client models), Flask, see [`trust-scoring-ml/`](trust-scoring-ml/)
- **Frontend**: React + TypeScript + Vite single-page app built from the wireframes (which are kept outside this repository), see [`frontend/`](frontend/)
- **Diagrams**: UML use case, class, and ER diagrams are kept outside this repository

## Documentation

- [Setup guide](docs/setup-guide.md): clone to a running system
- [Architecture](docs/architecture.md): components, escrow lifecycle, data model, key flows, security
- [Module map](docs/modules.md): where each module lives in the code
- [Backend API reference](backend/README.md)
- [Manual test pass](docs/manual-test-pass.md)

## Modules

1. System Documentation
2. Authentication & User Management (registration/login, RBAC for Client/Worker/Admin)
3. Escrow Payment (wallet fund lifecycle: pending → in escrow → completed/refunded)
4. Trust Scoring (two Random Forest models: worker and client, Flask microservice)
5. Payment Integration (Daraja STK Push, callbacks, B2C payouts)
6. Job Management (post/browse/apply/select)
7. Dispute & Refund Management + Administration

## Actors

Client, Worker, Admin.

## Status

Tracked via [Issues](https://github.com/JamieNguru/169421-escrow-based-wallet-and-payment-system/issues) and [Milestones](https://github.com/JamieNguru/169421-escrow-based-wallet-and-payment-system/milestones). See the trust-scoring service's own [README](trust-scoring-ml/README.md) for ML setup instructions.

The full capstone proposal (problem statement, literature review, methodology, system design) is kept outside this repository.
