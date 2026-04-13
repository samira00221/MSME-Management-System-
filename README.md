# MSME-Management-System
AI-Powered MSME Supply Chain Management System
An end-to-end digital operations platform for agricultural MSME suppliers in Rwanda
Status: Active	Node.js 22	Python 3.12	PostgreSQL	React PWA

1. Project Overview
The AI-Powered MSME Supply Chain Management System is a cloud-based, Progressive Web Application designed to digitise and automate the complete operational cycle of small and medium-sized agricultural suppliers in Rwanda. The platform targets a specific but pervasive gap: MSME food suppliers who serve institutional clients — schools, hospitals, hotels, and restaurants — but who manage their entire operation through WhatsApp messages, handwritten notes, and informal verbal agreements.

The system transforms this fragmented workflow into a structured, data-driven process that spans procurement consolidation, AI-assisted inventory management, digital delivery execution, automated invoicing, behavioral anomaly detection, and financial reporting — all within a single platform accessible from any device, including offline on mobile.

This repository contains the full source code for the three-tier system: the Node.js REST API backend, the Python FastAPI AI inference service, and the React PWA frontend.

2. The Problem Being Solved
Rwanda's agricultural supply chain is characterised by four structural gaps that this system directly addresses:

2.1  Last-Meter Reconciliation Gap
Fresh produce loses between 8% and 35% of its weight during cleaning and processing before delivery. Without a digital system, this shrinkage goes untracked. Suppliers sell by the kilogram but have no way of knowing whether the gap between purchased weight and delivered weight is within normal range or evidence of theft and mishandling. The result is daily, undetected revenue leakage.
 
2.2  Fragmented Procurement Gap
Suppliers receive orders from multiple institutional clients through multiple channels simultaneously — WhatsApp, phone calls, email, and in-person visits. Without consolidation, a supplier purchasing for ten school clients buys separately for each rather than in bulk, missing volume discounts, overpurchasing some products, and underpurchasing others.
2.3  Financial Leakage and Informal Oversight Gap
In semi-formal environments without structured ledgers, conventional fraud detection and audit tools cannot function. There is no clean financial record to analyse. The result is that price inflation at the market level, duplicate invoicing, and quantity manipulation during delivery remain invisible to management until the losses become too large to ignore.
2.4  Supplier Performance Information Gap
MSME suppliers in Rwanda lack verifiable performance records — on-time delivery rates, weight accuracy histories, anomaly resolution logs — that institutional buyers and financial institutions can use to make credit and procurement decisions. Without this data, suppliers cannot access formal credit or win larger institutional contracts, trapping them in informal, low-margin operations.

3. Solution Architecture
The platform is built on a three-service architecture that separates concerns cleanly across presentation, application logic, AI inference, and data persistence.

Layer	Technology	Port / Role
Presentation	React.js + Tailwind CSS + PWA	Port 5173 — Service workers + IndexedDB for offline
Application	Node.js 22 + Express 4	Port 3000 — Business logic, RBAC, REST API
AI / ML	Python 3.12 + FastAPI	Port 8001 — Shrinkage, anomaly, forecast models
Database	PostgreSQL 16	Port 5432 — Primary data store, 16 tables
Notifications	WhatsApp Business API 	Invoice delivery, alerts, confirmations
Payments	MTN Mobile Money 	MoMo Collections API + webhook handling
Maps	Google Maps / Geolocation API	POD geotag verification, delivery location

 
Communication Flow
The frontend communicates exclusively with the Node.js backend via HTTPS REST. The backend calls the Python AI service internally — the frontend never calls Python directly. Both the Node.js and Python services connect to the same PostgreSQL database: Node.js handles all writes; Python reads for model training only. If the AI service is unavailable, the Node.js aiService.js layer falls back to stored averages and safe defaults so the core platform never stops working.

4. System Modules
The system is organised into fourteen functional modules covering the complete operational lifecycle of an MSME supplier:

Module	Description	Key Features
Order Intake	Multi-channel order reception and consolidation	Manual entry, PDF/Excel import, WhatsApp parsing, order status tracking
Market Buy List	AI-assisted procurement consolidation engine	Aggregates all client orders, applies shrinkage buffers, generates market shopping list
Inventory	Stock intake, weight tracking, and batch management	Batch recording, pre/post-cleaning weights, expiry alerts, stock status
Deliveries	Dispatch management and field reconciliation	Stop sequencing, on-site quantity adjustment, offline-capable mobile interface
Proof of Delivery	Digital confirmation at point of delivery	Digital signature, photo capture, GPS geotag, offline sync
Invoices	Automated invoice generation and dispatch	Auto-generate from confirmed delivery, send via WhatsApp/SMS, PDF output
Payments	Multi-channel payment recording and reconciliation	Cash, MTN MoMo, Airtel Money, partial payment tracking, overdue alerts
Anomaly Detection	AI-powered behavioral anomaly scanning	Weight/invoice ratio, price variance, delivery timing, duplicate detection
Demand Forecasting	Weekly demand prediction with progressive learning	GradientBoosting model, school calendar signals, season adjustment, human override
Shrinkage Analytics	Predicted vs actual crop weight loss analysis	Per-product shrinkage trends, seasonal variance, model accuracy tracking
Financial Control	Ledger, receivables, and financial reporting	Revenue summary, accounts receivable, gross margin, procurement spend
Clients	Institutional client relationship management	Full CRUD, interaction logs, credit limits, balance tracking, performance history
Suppliers	Supplier profile and performance management	Performance rating, on-time delivery rate, weight accuracy score, vehicle fleet
Products	Product catalogue with AI-linked shrinkage data	Category management, shrinkage average sync from AI model, reorder points

5. AI and Machine Learning Layer
The Python FastAPI service provides three independent AI modules, each with its own training pipeline, cold-start fallback strategy, and scheduled retraining cycle.

5.1  Shrinkage Prediction Model
A RandomForestRegressor trained on the platform's own inventory records predicts the percentage of weight a specific crop will lose during cleaning and processing. Features include product type, season (dry, rainy, harvest), and purchased quantity. Before enough records accumulate for training, the model falls back to literature-based global averages from post-harvest loss research (Affognon et al., 2015). Predictions are called at Market Buy List generation time to inflate purchase quantities by the appropriate buffer before the supplier goes to market.
5.2  Behavioral Anomaly Detection
Five independent rule-and-signal detectors scan every operational event for irregularities. The system is designed specifically for semi-formal environments where conventional ledger-based fraud detection cannot function. The five detectors are: weight-to-invoice ratio mismatch (delivered weight vs billed amount); price variance above market average; delivery timing deviation; duplicate transaction detection across invoice history; and ingredient overconsumption against expected recipe standards. Each detector returns a severity level (low, medium, high, critical) and a confidence score. Anomalies are stored in the database and surfaced to administrators for resolution.
5.3  Demand Forecasting with Progressive Data Acquisition
A GradientBoostingRegressor predicts weekly demand per supplier-client-product combination. The key innovation is progressive data acquisition: the platform's own confirmed delivery records serve as the primary training dataset. As the system is used, the model improves automatically without external data collection. External signals augment the model: Rwanda Agriculture Board seasonal data, national school term calendars, and Rwanda Meteorology Agency weather feeds. Suppliers can override any AI prediction, and overrides are logged as training signals for future retraining cycles.
 
5.4  Model Operations
Both the shrinkage and forecast models retrain on a weekly schedule via a background thread in the Python service. Retraining is also triggerable manually by administrators through the Node.js API. Model versions are saved as timestamped .joblib files. Confidence scores and mean absolute error are tracked per version. All AI calls from Node.js pass through a single aiService.js file which handles timeouts, fallbacks, and logging centrally.

6. Backend Structure
The Node.js backend is organised by module — each domain owns its own controller and route file — with shared services for cross-cutting concerns.

Architecture	Module-based Express REST API with 14 domain modules
Authentication	JWT Bearer tokens, bcrypt password hashing, 7-day expiry
Authorisation	Role-Based Access Control — admin, sales_staff, field_staff
Validation	Joi schemas in shared/schemas — validated before controllers run
Database	node-postgres (pg) pool with query(), withTransaction() helpers
Audit Trail	Insert-only audit_logs table with DB-level UPDATE/DELETE rules
AI Integration	Centralised aiService.js — all Python calls with fallbacks
Notifications	notificationService.js — WhatsApp Business API + Africa's Talking SMS
Payments	momoController.js — MTN MoMo Collections API + webhook handler
Error Handling	AppError class + catchAsync wrapper + global errorHandler middleware
 
7. API Reference
All endpoints are prefixed with /api. Authentication is required on all routes except POST /api/auth/login.

Module	Method	Endpoint	Description
Auth	POST	/auth/login	Authenticate and receive JWT token
Auth	GET	/auth/me	Get current authenticated user
Auth	POST	/auth/register	Create new user account (admin only)
Dashboard	GET	/analytics/dashboard/kpis	Today's revenue, stock, anomaly summary
Dashboard	GET	/analytics/dashboard/anomaly-alerts	Pending anomalies by severity
Dashboard	GET	/analytics/dashboard/recent-activity	Latest audit log events
Orders	GET	/orders	List orders with filters
Orders	POST	/orders	Create manual order with line items
Orders	POST	/orders/import	Import orders from PDF or Excel file
Buy List	POST	/procurement/generate	Consolidate orders + apply AI shrinkage buffers
Buy List	PUT	/procurement/items/:id	Record actual market purchase price and qty
Inventory	POST	/inventory	Create inventory batch after market purchase
Inventory	PUT	/inventory/:id/shrinkage	Record post-cleaning weight (triggers AI check)
Deliveries	POST	/deliveries	Create delivery run with stops and items
Deliveries	PUT	/deliveries/:id/start	Mark delivery as in progress
Deliveries	PUT	/deliveries/stops/:id	Confirm stop, adjust quantities on-site
Deliveries	POST	/deliveries/stops/:id/pod	Capture POD: signature, photo, GPS
Invoices	POST	/invoices	Auto-generate invoice from confirmed delivery
Invoices	POST	/invoices/:id/send	Send invoice via WhatsApp or SMS
Invoices	POST	/invoices/:id/payment	Record cash or Mobile Money payment
Anomalies	GET	/anomalies	List flagged anomalies with filters
Anomalies	PUT	/anomalies/:id/resolve	Mark anomaly as reviewed with notes
Anomalies	POST	/anomalies/scan	Run end-of-day AI batch anomaly scan
Forecasts	POST	/analytics/forecasts/predict	Request AI demand prediction for a week
Forecasts	POST	/analytics/forecasts/actual	Record actual qty (feeds model retraining)
Financial	GET	/finance/summary	Revenue, spend, margin for date range
Financial	GET	/finance/client-balances	Outstanding amounts per client
Financial	GET	/finance/shrinkage-analytics	Predicted vs actual shrinkage by product
MoMo	POST	/integrations/momo/request	Initiate Mobile Money payment request
MoMo	POST	/integrations/momo/webhook	Receive payment confirmation from MoMo API
Clients	GET	/clients	List clients with balance and order summary
Clients	POST	/clients	Create institutional client profile
Suppliers	POST	/suppliers/:id/recalculate-rating	Recalculate performance score from delivery data
Products	POST	/products/:id/sync-shrinkage	Sync shrinkage average from AI model history

8. User Roles and Access
The system implements three roles with progressively narrower access scopes:

Role	Access Scope	Primary Interface
Admin	Full system access — all modules, user management, AI retraining, anomaly escalation, financial reports	Web dashboard — full navigation
Sales Staff	Order intake, buy list, inventory, invoices, payments, client management, anomaly review	Web dashboard — operations and intelligence
Field Staff	Delivery stop confirmation, quantity adjustment on-site, proof of delivery capture	Mobile PWA — offline capable

9. Getting Started
Prerequisites
•	Node.js v22+
•	Python 3.12+ with pip
•	PostgreSQL 16+
•	npm or yarn

Step 1 — Clone and install
git clone https://github.com/samira00221/MSME-Management-System-.git
cd msme-system

Step 2 — Configure environment variables
Copy .env.example to .env in both msme-backend/ and msme-ai-service/ and fill in your credentials: database URL, JWT secret, WhatsApp token, MoMo API key, SMS API key, and AI service URL.

Step 3 — Set up the database
CREATE DATABASE msme_db;   -- in psql
cd msme-backend && npm run migrate

Step 4 — Run all three services
# Terminal 1 — Node.js backend
cd msme-backend && npm run dev

# Terminal 2 — Python AI service
cd msme-ai-service && source venv/bin/activate && uvicorn main:app --port 8001 --reload

# Terminal 3 — React frontend
cd msme-frontend && npm run dev

Step 5 — Health checks
•	Backend: GET http://localhost:3000/health
•	AI Service: GET http://localhost:8001/health
•	Frontend: http://localhost:5173

10. Database Schema
The PostgreSQL schema contains 16 tables covering the complete operational domain. Key design decisions:

•	users, suppliers, clients, products — master data with soft delete (is_active flag)
•	client_orders, order_items — order header and line items with source tracking
•	market_buy_lists, buy_list_items — procurement consolidation with AI shrinkage fields
•	inventory — batch tracking with quantity_purchased, quantity_after_processing, and shrinkage computed column
•	deliveries, delivery_stops, delivery_items — three-level delivery structure
•	proof_of_delivery — ON CONFLICT upsert for offline sync collision handling
•	invoices, payments — full billing cycle with status state machine
•	financial_records — insert-only ledger for all monetary movements
•	anomalies — AI-detected irregularities with resolution workflow
•	demand_forecasts — predicted and actual quantities for model feedback loop
•	audit_logs — DB-level UPDATE/DELETE rules make this table immutable

11. Key Design Decisions
Progressive data acquisition	The AI models train on the system's own transactional records. There is no dependency on external datasets. The models improve automatically as the platform is used.
Cold-start fallback strategy	Before enough records exist to train, shrinkage uses literature-based global crop averages (Affognon et al., 2015). Forecasting falls back to a rolling average from recent orders.
aiService.js as single gateway	All calls from Node.js to Python pass through one file. Timeout, fallback, and retry logic lives in one place. If Python is down, the core platform continues working.
Behavioral anomaly detection	The system does not require clean financial ledgers to detect fraud. It reads operational signals — weight gaps, timing deviations, price patterns — making it viable in semi-formal MSME environments.
Offline-first field operations	Delivery confirmation works without connectivity. Service workers cache the PWA; IndexedDB queues changes locally; sync happens automatically when connectivity returns with conflict resolution.
withTransaction() wrapper	All multi-table write operations — create order + items, generate buy list, record payment + update invoice + financial record — execute inside a single PostgreSQL transaction.
Insert-only audit log	The audit_logs table has DB-level rules preventing UPDATE and DELETE. The audit trail is immutable at the database level, not just the application level.
Route optimisation excluded	Delivery sequencing is managed manually by administrators. AI is reserved for shrinkage, anomaly detection, and demand forecasting — three areas with clear thesis-defensible contributions.

12. Research Context
This system is developed as part of a computer science thesis at a Rwandan university. The implementation is designed for 2J Supplier as a primary case study, with an architecture intentionally built to be adaptable for other MSME agricultural suppliers within Rwanda's value chain.

The system directly responds to four research-identified operational gaps in Rwanda's post-harvest agricultural supply chain, as documented in MINAGRI (2024), World Bank (2024), and the Rwanda National AI Policy (Ministry of ICT and Innovation, 2023). The AI/ML components align with the progressive data acquisition approach recommended in Walter, Ahsan & Rahman (2025) for low-data MSME contexts.

Selected References
•	Affognon, H. et al. (2015). Unpacking post-harvest losses in sub-Saharan Africa. World Development, 66, 49-68.
•	MINAGRI. (2024). Annual report 2023-2024: Strategic plan for agricultural transformation. Government of Rwanda.
•	Ministry of ICT and Innovation. (2023). Rwanda national artificial intelligence policy. Government of Rwanda.
•	Walter, A., Ahsan, K., & Rahman, S. (2025). AI applications in supply chain demand planning. IJLM, 36(3), 672-719.
•	World Bank. (2024). Rwanda economic update: Modernizing agriculture. World Bank Group.

13. Licence and Contact
This project is developed for academic and research purposes. For enquiries regarding the system, the thesis, or potential deployment for other MSME suppliers, please open an issue in this repository.


Built for Rwanda's agricultural MSME sector  ·  Node.js + Python + React + PostgreSQL
