-- Run in Supabase SQL Editor. Never expose the service-role key in browser code.
create table if not exists public.products (
  id bigint primary key,
  name text not null,
  price numeric(10,2) not null check (price > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  order_id text unique not null,
  customer_username text,
  customer_name text not null,
  phone text not null,
  address text not null,
  city text not null,
  state text not null,
  pin text not null,
  items jsonb not null,
  total_inr numeric(10,2) not null check (total_inr > 0),
  payment_status text not null default 'created' check (payment_status in ('created','paid','failed','refunded')),
  order_status text not null default 'Pending' check (order_status in ('Pending','Confirmed','Packed','Shipped','Delivered','Cancelled')),
  payment_provider text not null default 'razorpay',
  razorpay_order_id text unique,
  razorpay_payment_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- Starter prices must match the demo catalog. Update products here before accepting real orders.
insert into public.products (id,name,price,active) values
(1,'Classic Oversized T-Shirt',499,true),
(2,'Relaxed Fit Hoodie',999,true),
(3,'Everyday Casual Shirt',799,true),
(4,'Women''s Essential Top',599,true),
(5,'Classic Denim Jeans',1199,true),
(6,'Streetwear Cargo Pants',1099,true),
(7,'Everyday Baseball Cap',299,true),
(8,'Minimal Tote Bag',399,true)
on conflict (id) do update set name=excluded.name, price=excluded.price, active=excluded.active;

-- This starter uses the server-side service-role key. Keep RLS enabled and never expose that key to browsers.
alter table public.products enable row level security;
alter table public.orders enable row level security;
-- No public policies are created intentionally. Server access uses the private service-role key.
