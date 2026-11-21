# RentEquip — Equipment Rental Platform (Server)

Enterprise REST API backend for RentEquip, built with Node.js, Express, TypeScript, MongoDB Atlas, and Stripe.

**Assignment 9 — Category 003: Equipment Rental Platform**

- **Live Server URL**: [https://equipment-rental-server-delta.vercel.app](https://equipment-rental-server-delta.vercel.app)
- **Client Application**: [https://equipment-rental-client-nine.vercel.app](https://equipment-rental-client-nine.vercel.app)

---

## Architectural Highlights

- **Authentication & Security**:
  - BetterAuth with MongoDB adapter and RS256 JWKS JWT issuance (`/api/auth/*splat`).
  - Remote JWKS verification with real-time database role check via `jose` and `jsonwebtoken`.
  - Roles: `Customer`, `Owner`, `Admin`.
  - Password strength validation: minimum 6 characters, at least 1 uppercase and 1 lowercase letter.
  - Safe regex escaping (`escapeRegex`) preventing regex injection attacks on search queries.
  - Public equipment endpoints sanitize owner PII, exposing full owner contact details exclusively on authenticated details requests.

- **Stripe Payment Gateway Integration**:
  - Stripe Checkout Sessions (`/api/bookings/checkout`) with server-enforced total calculation.
  - Idempotent session verification (`/api/bookings/verify-session/:sessionId`) recording payment records in `payments` collection and atomically decrementing equipment inventory.

- **Automated Scheduling (Challenge 3)**:
  - Automated status updater runs on startup and hourly interval, automatically transitioning confirmed rentals past their end date to `Completed`.
  - Dynamic MongoDB aggregation pipelines calculating 6-month monthly revenue and booking statistics for both Admin and Owner analytics.

- **Server-Side ImgBB Image Proxy**:
  - `POST /api/upload/image`: Client uploads base64 images to server; server forwards to ImgBB using secret `IMGBB_API_KEY`, protecting API keys from browser exposure.

---

## API Routes Overview

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Public | Register new customer account (default role: Customer) |
| `POST` | `/api/auth/login` | Public | Sign in with email and password |
| `POST` | `/api/auth/google` | Public | Sign in with Google OAuth 2.0 |
| `GET` | `/api/auth/me` | Authenticated | Retrieve current user profile |
| `PATCH` | `/api/auth/profile` | Authenticated | Update user name, phone, address, and avatar |
| `POST` | `/api/upload/image` | Authenticated | Upload machinery/profile images via ImgBB proxy |
| `GET` | `/api/equipment/featured` | Public | Fetch exactly 6 featured approved items |
| `GET` | `/api/equipment` | Public | All approved equipment with search, filter, sort & pagination |
| `GET` | `/api/equipment/:id` | Authenticated | Full equipment specifications & owner contact details |
| `POST` | `/api/equipment` | Owner / Admin | List new equipment (initial status: Pending) |
| `PATCH` | `/api/equipment/:id` | Owner / Admin | Update equipment details (owner can only update own) |
| `DELETE` | `/api/equipment/:id` | Owner / Admin | Delete equipment (owner can only delete own) |
| `PATCH` | `/api/equipment/:id/status`| Admin | Approve or reject equipment listing |
| `GET` | `/api/favorites` | Authenticated | List user saved favorites |
| `POST` | `/api/favorites/:id` | Authenticated | Add equipment to favorites |
| `DELETE` | `/api/favorites/:id` | Authenticated | Remove equipment from favorites |
| `POST` | `/api/bookings/checkout` | Renter | Create Stripe Checkout session with server price calculation |
| `GET` | `/api/bookings/verify-session/:id` | Authenticated | Verify Stripe payment, record booking, decrement stock |
| `GET` | `/api/bookings/my-rentals` | Renter | Retrieve customer rental booking history |
| `GET` | `/api/bookings/owner/my-rentals` | Owner | Retrieve client bookings for owner's equipment |
| `GET` | `/api/bookings/admin/all` | Admin | Retrieve all platform rental records |
| `POST` | `/api/bookings/webhook` | Stripe System | Webhook endpoint (signature verification, idempotent fulfillment) |
| `PATCH` | `/api/bookings/:id/status` | Owner / Admin | Update booking status (`Completed`, `Cancelled`) |
| `GET` | `/api/users` | Admin | Search and list platform users |
| `PATCH` | `/api/users/:id/role` | Admin | Change user role (`Customer`, `Owner`, `Admin`) |
| `DELETE` | `/api/users/:id` | Admin | Delete user account |
| `GET` | `/api/analytics/admin` | Admin | Dynamic aggregations (users, equipment, revenue, monthly stats) |
| `GET` | `/api/analytics/owner` | Owner | Owner dynamic aggregations (equipment, active/completed, earnings) |

---

## Environment Variables Setup

Create a `.env` file in the `server` directory:

```env
PORT=5000
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/equipment_rental?retryWrites=true&w=majority
JWT_SECRET=your_jwt_secret_key
CLIENT_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
IMGBB_API_KEY=your_imgbb_api_key

# Nodemailer SMTP Configuration (For automated rental completion notifications)
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your_smtp_username
SMTP_PASS=your_smtp_password
SMTP_FROM="RentEquip Notifications" <no-reply@rentequip.com>
```

---

## Local Development & Compilation

```bash
# Navigate to server directory
cd server

# Install dependencies
npm install

# Build TypeScript to dist
npm run build

# Start production build
npm start

# Or start development server with ts-node
npm run dev
```
