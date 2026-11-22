# RentEquip — Commercial Equipment Rental Platform (Server)

Enterprise REST API backend for the **RentEquip** commercial equipment rental platform. Built with **Node.js**, **Express**, **TypeScript**, **MongoDB Atlas**, **Mongoose**, **BetterAuth**, and **Stripe**.

> **Academic Context:**  
> Developed for **Assignment 9 — Category 003: Equipment Rental Platform**.  
> Implements strict server-side validation, JWT authentication with RS256 JWKS verification, role-based access control, dynamic multi-attribute database filtering, Stripe Test Mode payment fulfillment, and automated scheduled maintenance.

---

## 1. Project URLs

- **Live Server Root:** [https://equipment-rental-server-delta.vercel.app](https://equipment-rental-server-delta.vercel.app)
- **Live Health Check:** [https://equipment-rental-server-delta.vercel.app/api/health](https://equipment-rental-server-delta.vercel.app/api/health)
- **Live Client Application:** [https://equipment-rental-client-nine.vercel.app](https://equipment-rental-client-nine.vercel.app)
- **Server Local Port:** `http://localhost:5000`
- **Client Local Port:** `http://localhost:3000`

---

## 2. Backend Architecture

The backend follows a layered MVC architectural pattern designed for high reliability across both standalone Node.js environments and Vercel serverless functions:

```
server/
├── src/
│   ├── config/             # Database connection, BetterAuth, MongoDB client
│   │   ├── auth.ts         # BetterAuth instance with MongoDB adapter
│   │   ├── db.ts           # Mongoose connection pooling & readyState monitoring
│   │   └── mongoClient.ts  # Native MongoClient instance for BetterAuth
│   ├── middlewares/        # Authentication & Role Authorization guards
│   │   └── auth.ts         # verifyToken, verifyRenter, verifyOwner, verifyAdmin
│   ├── models/             # Mongoose schemas & TypeScript interfaces
│   │   ├── Booking.ts      # Rental bookings with status lifecycle
│   │   ├── Equipment.ts    # Machinery catalog schemas & condition enums
│   │   ├── Favorite.ts     # Customer machinery bookmarks
│   │   ├── Payment.ts      # Transaction records with Stripe reference IDs
│   │   └── User.ts         # User accounts with hashed passwords & roles
│   ├── routes/             # Express API route controllers
│   │   ├── analytics.routes.ts # Admin & Owner aggregation pipelines (Challenge 3)
│   │   ├── auth.routes.ts      # Register, Login, Google OAuth, Profile
│   │   ├── booking.routes.ts   # Stripe checkout, webhook, rental CRUD
│   │   ├── cron.routes.ts      # Vercel cron endpoints for rental maintenance
│   │   ├── equipment.routes.ts # Catalog search, filters, owner/admin CRUD
│   │   ├── favorite.routes.ts  # Add/remove/check customer favorites
│   │   ├── upload.routes.ts    # ImgBB image upload proxy
│   │   └── user.routes.ts      # Admin user management & role elevation
│   ├── services/           # Background scheduling & third-party integrations
│   │   ├── cron.service.ts     # Rental expiration processor & stock restorer
│   │   └── email.service.ts    # Nodemailer completion notification dispatcher
│   └── server.ts           # Express application entry point & CORS configuration
├── package.json
└── tsconfig.json
```

---

## 3. Technology Stack & Dependencies

| Package / Tool | Version | Purpose |
|---|---|---|
| **Express** | `^5.3.0` | Fast, unopinionated HTTP routing engine |
| **TypeScript** | `^7.0.2` | Static typing, interface contracts, and compiler tooling |
| **MongoDB Driver** | `^7.9.1` | Native database client powering BetterAuth adapter |
| **Mongoose** | `^9.12.3` | Schema modeling, query building, and validation |
| **BetterAuth** | `^1.7.27` | OAuth authentication and social provider integration |
| **@better-auth/mongo-adapter** | `^1.7.27` | MongoDB session and account adapter |
| **Stripe Node SDK** | `^23.2.0` | Stripe Checkout sessions, webhook verification (Test Mode) |
| **jose** | `^6.2.18` | Remote JWKS client and RS256 token verification |
| **jsonwebtoken** | `^9.0.3` | Dual-compatibility JWT signing and HS256 verification |
| **bcryptjs** | `^3.0.3` | Salted password hashing (10 salt rounds) |
| **node-cron** | `^4.6.0` | Background task scheduling for expired rental sweeping |
| **nodemailer** | `^10.6.1` | SMTP email dispatch for completed rental notifications |
| **cors** | `^2.8.6` | Cross-Origin Resource Sharing with allowed origin guards |
| **dotenv** | `^18.0.10` | Environment variable loader from `.env` |

---

## 4. Database Architecture & Schemas

### MongoDB Atlas Configuration
- Operates on a dedicated MongoDB Atlas cluster (`equipment_rental` database).
- **Connection Pooling:** Cached Mongoose connection instance prevents socket starvation in Vercel serverless environments.
- **Health Check Endpoint (`/api/health`):** Accurately reports `readyState` (1 = connected, 0 = disconnected, 2 = connecting, 3 = disconnecting).

### Key Collections & Schemas
1. **`users`:** Stores user credentials, hashed passwords, roles (`Customer`, `Owner`, `Admin`), contact phone, address, and profile avatars.
2. **`equipment`:** Contains commercial machinery listings with name, description, category, rental rate, rental frequency (`Daily`, `Weekly`, `Monthly`), available quantity, condition (`New`, `Good`, `Fair`), brand, model, location, image URL, rental terms, approval status (`Pending`, `Approved`, `Rejected`), currency (`BDT`), and owner ObjectId reference.
3. **`bookings`:** Tracks customer rentals with equipment reference, renter reference, owner reference, start date, end date, quantity, total amount in BDT, payment status (`Pending`, `Paid`, `Refunded`), booking status (`Confirmed`, `Completed`, `Cancelled`), contact phone, and delivery address.
4. **`payments`:** Financial transaction logs storing booking reference, renter reference, Stripe checkout session ID (`cs_test_...`), Stripe payment intent ID (`pi_...`), amount paid in BDT, currency, and payment method details.
5. **`favorites`:** Records customer bookmarked equipment with compound unique index on `(userId, equipmentId)`.
6. **`user` & `account` & `session`:** BetterAuth internal collections managing OAuth sessions and Google credential mappings.

---

## 5. Authentication, JWT/JWKS & Role-Based Middleware

### Dual-Compatibility Authentication Architecture
RentEquip implements a dual-compatible authentication mechanism:
1. **BetterAuth & Google OAuth 2.0:** Handles social sign-in and generates session tokens. Evaluators clicking *"Continue with Google"* are automatically registered with the default `Customer` role.
2. **Email & Password Registration:** Enforces assignment-mandated password rules:
   - Minimum 6 characters
   - At least 1 uppercase letter (`/[A-Z]/`)
   - At least 1 lowercase letter (`/[a-z]/`)
3. **JWT Access Tokens:** Issues signed access tokens (7-day validity) bearing `id`, `email`, `role`, and `name`.

### Role-Based Access Control Middlewares (Challenge 2)
Located in `src/middlewares/auth.ts`:
- **`verifyToken`:** Validates Bearer tokens using remote BetterAuth JWKS (RS256) or fallback secret (HS256). Fetches the user's live role directly from MongoDB to prevent stale role authorization attacks.
- **`verifyRenter`:** Enforces that the caller is an authenticated customer or admin.
- **`verifyOwner`:** Enforces that the caller holds the `Owner` or `Admin` role. Blocks regular customers from accessing owner fleet controls.
- **`verifyAdmin`:** Restricts moderation, user management, and global audit routes strictly to platform administrators.

---

## 6. Complete API Endpoint Documentation

### Authentication & User Profile (`/api/auth`)
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | Public | Register new account (enforces password rules; default role: Customer) |
| `POST` | `/api/auth/login` | Public | Authenticate with email/password; returns JWT access token |
| `POST` | `/api/auth/google` | Public | Social OAuth sign-in bridge; ensures customer account creation |
| `GET` | `/api/auth/session-token` | Public | Hydrate session token from BetterAuth session cookie |
| `GET` | `/api/auth/me` | Authenticated | Retrieve currently authenticated user profile |
| `PATCH` | `/api/auth/profile` | Authenticated | Update user name, phone, delivery address, or avatar URL |

### Machinery & Equipment Management (`/api/equipment`)
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/equipment/featured` | Public | Retrieve 6 approved items via MongoDB `.limit(6)` |
| `GET` | `/api/equipment` | Public | Search, filter (category, rental type, price range, availability), sort, and paginate |
| `GET` | `/api/equipment/:id` | Authenticated | Private route retrieving machinery details and owner contact |
| `POST` | `/api/equipment` | Owner / Admin | List new machinery (initial status: `Pending`) |
| `PATCH` | `/api/equipment/:id` | Owner / Admin | Update machinery details (owners can only modify own equipment) |
| `PUT` | `/api/equipment/:id` | Owner / Admin | Full replacement of equipment details |
| `PATCH` | `/api/equipment/:id/status`| Admin | Moderate listing: transition status to `Approved` or `Rejected` |
| `DELETE` | `/api/equipment/:id` | Owner / Admin | Remove equipment listing |
| `GET` | `/api/equipment/owner/my-equipment` | Owner / Admin | Paginated list of machinery owned by current user |
| `GET` | `/api/equipment/admin/all` | Admin | Paginated list of all platform machinery for moderation |

### Rental Bookings & Stripe Test Mode Payments (`/api/bookings`)
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/bookings/checkout` | Customer / Admin | Validate dates & stock; calculate BDT total; create Stripe Checkout Session |
| `POST` | `/api/bookings/webhook` | Stripe System | Raw webhook endpoint; verify signature; confirm booking & payment |
| `GET` | `/api/bookings/verify-session/:sessionId` | Authenticated | Fallback idempotent verification and payment reconciliation |
| `GET` | `/api/bookings/my-rentals` | Customer / Admin | Retrieve customer's personal booking history |
| `GET` | `/api/bookings/owner/my-rentals` | Owner / Admin | Retrieve customer bookings made on owner's machinery |
| `GET` | `/api/bookings/admin/all` | Admin | Retrieve all rental transactions across the entire platform |
| `PATCH` | `/api/bookings/:id/status` | Owner / Admin | Transition rental status (`Completed`, `Cancelled`) |

### Customer Saved Favorites (`/api/favorites`)
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/favorites` | Authenticated | Retrieve customer's bookmarked machinery list |
| `GET` | `/api/favorites/check/:equipmentId` | Authenticated | Query whether a specific equipment item is favorited |
| `POST` | `/api/favorites/:equipmentId` | Authenticated | Add equipment item to favorites |
| `DELETE` | `/api/favorites/:equipmentId` | Authenticated | Remove equipment item from favorites |

### Administrative User Management (`/api/users`)
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/users` | Admin | Paginated user directory with search by name or email |
| `PATCH` | `/api/users/:id/role` | Admin | Update user role (`Customer`, `Owner`, `Admin`) |
| `DELETE` | `/api/users/:id` | Admin | Delete a user account |

### Dynamic Dashboard Analytics (`/api/analytics` — Challenge 3)
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/analytics/admin` | Admin | Aggregations for total users, equipment, bookings, revenue, and monthly trends |
| `GET` | `/api/analytics/owner` | Owner / Admin | Aggregations for owner listings, active rentals, total earnings, monthly revenue |

### Image Upload Proxy (`/api/upload`)
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/upload/image` | Public | Accepts base64 image; forwards to ImgBB API using server-side secret key |

### Scheduled Maintenance & Cron (`/api/cron`)
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/cron/process-expired-rentals` | Public / Cron Secret | Sweeps completed rentals, restores stock, and dispatches completion emails |

---

## 7. Stripe Test Mode Workflow & Idempotency Protection

### Server-Enforced Checkout
1. Customer selects start date, end date, and quantity in the frontend modal.
2. `POST /api/bookings/checkout` validates that `startDate` is before `endDate`, calculates total duration days, checks available quantity, and queries the database for the unit rental rate.
3. Constructs a Stripe Checkout session in currency `bdt` with unit amount in paisa (`totalPrice * 100`).
4. Attaches metadata: `bookingId`, `equipmentId`, `renterId`, `ownerId`, `quantity`.

### Idempotent Fulfillment & Stock Protection
- Webhook signature is validated using `stripe.webhooks.constructEvent()` against `STRIPE_WEBHOOK_SECRET`.
- When `checkout.session.completed` fires:
  1. Verifies if the booking was already marked `Paid` to prevent double-processing.
  2. Updates booking payment status to `Paid` and status to `Confirmed`.
  3. Creates an immutable `Payment` record with Stripe references.
  4. Atomically decrements equipment `availableQuantity` using `$inc: { availableQuantity: -quantity }`.
- Duplicate webhook payloads or browser refresh on `/payment/success` execute idempotently without duplicate records or stock over-decrement.

---

## 8. Scheduled Cron & Notification Processing

- **Local Development:** `node-cron` schedules an hourly job (`0 * * * *`) that sweeps all `Confirmed` rentals where `endDate <= new Date()`.
- **Vercel Serverless:** Vercel Cron triggers `GET /api/cron/process-expired-rentals` periodically.
- **Fulfillment Actions:**
  1. Updates booking status to `Completed`.
  2. Restores equipment stock via `$inc: { availableQuantity: quantity }`.
  3. Dispatches formatted completion notification emails to both renter and owner via Nodemailer (`email.service.ts`).

---

## 9. Environment Variables Configuration

Create a `.env` file in the `server` root directory:

```env
# Server Network Port
PORT=5000

# Client Application URL
CLIENT_URL=http://localhost:3000

# MongoDB Atlas Connection URI
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/equipment_rental?retryWrites=true&w=majority

# JWT Signing Secret Key
JWT_SECRET=your_secure_jwt_secret_key

# BetterAuth Base Origin
BETTER_AUTH_URL=http://localhost:5000

# Google OAuth 2.0 Credentials
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Stripe Test Mode Keys (TEST MODE ONLY - Never use live keys)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# ImgBB Image Upload API Key
IMGBB_API_KEY=your_imgbb_api_key

# Vercel Cron Secret (Optional authorization for cron endpoint)
CRON_SECRET=your_cron_secret_token

# Nodemailer SMTP Configuration
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your_smtp_username
SMTP_PASS=your_smtp_password
SMTP_FROM="RentEquip Notifications" <no-reply@rentequip.com>
```

> **Security Reminder:** Never commit `.env` files to source control. Production environments must inject these variables through Vercel Project Settings.

---

## 10. Local Installation & Development

### Prerequisites
- Node.js 18.x, 20.x, or 22.x
- npm 9.x or higher
- Accessible MongoDB Atlas database

### Setup Instructions

1. **Navigate to the Server directory:**
   ```bash
   cd server
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Create `.env` using the template above with your sandbox/test credentials.

4. **Start the development server with live reload:**
   ```bash
   npm run dev
   ```

5. **Compile TypeScript for production:**
   ```bash
   npm run build
   ```

6. **Start production server:**
   ```bash
   npm start
   ```

7. **Verify server health:**
   Open [http://localhost:5000/api/health](http://localhost:5000/api/health) in your browser. Expected response:
   ```json
   {
     "status": "ok",
     "database": {
       "connected": true,
       "readyState": 1,
       "stateDescription": "connected"
     }
   }
   ```

---

## 11. Security & Operational Hardening

1. **NoSQL Injection Defense:** All user search inputs are sanitized with `escapeRegex()` before regular expression construction, preventing catastrophic backtracking and injection attacks.
2. **Strict CORS Policy:** Restricted to approved client origins (`CLIENT_URL` and `*.vercel.app`), blocking unauthorized external domains from invoking authenticated APIs.
3. **Owner PII Protection:** Public catalog and featured endpoints strip owner email and phone number, only serving owner contact information on authenticated equipment detail queries.
4. **Stripe Test Mode Isolation:** Exclusively operates in Stripe Test Mode (`acct_1UccAjQWXp15rAg8`). Real credit card transactions are prohibited.
5. **No Published Secrets:** Production secrets, API keys, and database passwords are never placed in documentation, repositories, or client bundles.
