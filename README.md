# HT COLLECTION — Live Store Starter

This is a **deployment starter**, not a store that is already online. It adds a server-side Razorpay checkout flow and Supabase order storage to the existing storefront. You must create your own accounts, configure keys, deploy the server, and test payments before taking real orders.

## Included
- Existing HT COLLECTION storefront, cart, product catalogue, customer-facing help/return and order lookup screens.
- Razorpay Checkout integration: the server creates payment orders, calculates prices from the `products` database table, and verifies the Razorpay signature on the server before marking an order paid.
- Supabase PostgreSQL storage for orders and server-side catalogue price lookup.
- Optional Razorpay webhook endpoint for payment event updates.
- Basic security headers and API rate limiting.
- Customer-facing wishlist (browser-saved), general clothing size guide, and secure order tracking by Order ID plus checkout phone number.
- Customer-friendly checkout error messages.

## Important limitations before public launch
- The existing demo's customer accounts, wishlist/cart state, admin login, product editing, return requests and business dashboard still contain browser-only/demo logic. **Do not treat these as secure production authentication or shared customer/order management.** The admin username/password in the old demo must not be used on a public site; replace the admin area with server-side authentication before launch.
- Products added in the demo admin screen are not automatically synced to the `products` table. Add/edit product prices in Supabase until a secure admin API is implemented.
- Wishlist is saved in the customer's browser and will not sync across devices until customer accounts are migrated.
- Customer account passwords in the original demo are stored in browser local storage. Do not collect real customer passwords with that demo flow. A production release should replace it with Supabase Auth (or another managed auth provider).
- This project does not register a domain, deploy itself, or activate your Razorpay merchant account.
- Start with Razorpay **test keys**. Switch to live keys only after your merchant account is approved and test orders/webhooks are verified. Payment settlement is subject to Razorpay onboarding and bank/account checks.
- Add a privacy policy, terms, shipping policy, return/refund policy, contact details and business/tax information as applicable before launch.

## Setup (computer recommended)
1. Install Node.js 20 or newer.
2. Create a Supabase project at https://supabase.com/.
3. Open Supabase **SQL Editor** and run `sql/schema.sql`.
4. Create a Razorpay account at https://razorpay.com/ and obtain **test** API keys from its dashboard.
5. Copy `.env.example` to `.env`, then fill in:
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - optional `RAZORPAY_WEBHOOK_SECRET`
6. Keep `.env` private. Never upload it to a public repository or paste secrets into chat. The Supabase service-role key and Razorpay secret must only exist on the server.
7. Run:
   ```bash
   npm install
   npm start
   ```
8. Open `http://localhost:3000`. Check `http://localhost:3000/api/health`; `paymentConfigured` should be `true`.
9. Use Razorpay test payment methods and confirm that an order row appears in Supabase with `payment_status = paid` only after server-side signature verification.
10. Deploy the Node server to a host that supports Node.js and HTTPS (for example Render, Railway, or another provider). Set environment variables in the hosting dashboard; do not deploy `.env`.
11. In Razorpay, configure webhook URL `https://YOUR-DOMAIN/api/webhooks/razorpay`, use the exact webhook secret in your environment, and subscribe to `payment.captured` and `payment.failed`.
12. Only after successful testing and merchant approval, switch to live API keys.

## Current payment behavior
- The server rejects checkout if required credentials or Supabase tables are missing.
- Product IDs/prices are validated against `public.products`; the browser does not decide the charge amount.
- An order is stored as `created` before payment. A verified signature changes it to `paid`.
- If the customer closes the payment window, the order may remain `created`; the owner should reconcile pending payments before fulfilment.
- Do not mark an order paid manually just because a customer shares a screenshot. Verify in Razorpay dashboard and database.

## Security checklist
- Remove demo admin credentials and browser-only admin tools before public launch.
- Implement Supabase Auth for customer accounts and role-protected admin routes.
- Move product management, order-status updates, returns, coupons, reviews and customer history to authenticated server/database APIs.
- Add webhook replay/idempotency handling, monitoring, backups and an explicit refund workflow before processing real payments.
- Configure production HTTPS and restrict database permissions.
