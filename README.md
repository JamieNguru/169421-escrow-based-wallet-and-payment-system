# Escrow-Based Wallet and Payment System

An escrow-based wallet and payment simulation system with Random Forest-powered trust scoring for digital labour platforms in East Africa. Capstone project by Jamie Nguru Kibanya, BSc Informatics and Computer Science, Strathmore University, supervised by Mr. James Njihia.

## Problem

Digital labour platforms in East Africa rely on informal mobile-money transfers with no escrow, no dispute resolution, and no reliable trust signal — clients risk paying for undelivered work, and workers risk non-payment.

## Solution

1. An escrow-based wallet and payment simulation: funds are held in escrow, released on confirmed job completion, refunded on disputes, with M-Pesa Daraja API (sandbox) integration and multi-currency support (KES, UGX, TZS, USD).
2. Two Random Forest trust-scoring models — one for workers, one for clients — that classify users into Low/Medium/High trust based on their transaction history, served through a single role-aware Flask microservice.

## Architecture

- **Backend**: Node.js + Express, Firebase Firestore
- **Trust-scoring microservice**: Python, scikit-learn Random Forest (separate worker and client models), Flask — see [`trust-scoring-ml/`](trust-scoring-ml/)
- **Frontend**: built from wireframes kept outside this repository
- **Diagrams**: UML use case, class, and ER diagrams are kept outside this repository

## Modules

1. System Documentation
2. Authentication & User Management (registration/login, RBAC for Client/Worker/Admin)
3. Escrow Payment (wallet fund lifecycle: pending → in escrow → completed/refunded)
4. Trust Scoring (two Random Forest models — worker and client — Flask microservice)
5. Payment Integration (Daraja STK Push, callbacks, B2C payouts)
6. Job Management (post/browse/apply/select)
7. Dispute & Refund Management + Administration

## Actors

Client, Worker, Admin.

## Status

Tracked via [Issues](../../issues) and [Milestones](../../milestones). See the trust-scoring service's own [README](trust-scoring-ml/README.md) for ML setup instructions.

The full capstone proposal (problem statement, literature review, methodology, system design) is kept outside this repository.
