require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Razorpay = require("razorpay");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb", verify: (req, res, buf) => {
  if (req.originalUrl === "/api/webhooks/razorpay") req.rawBody = Buffer.from(buf);
} }));
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 100 }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3000);
const required = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
function configReady() { return required.every(k => process.env[k] && !process.env[k].includes("replace_me")); }
function clients() {
  if (!configReady()) throw new Error("Server setup incomplete. Store owner must configure Razorpay and Supabase environment variables.");
  return {
    razorpay: new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET }),
    supabase: createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  };
}
function fail(res, err, status = 400) {
  console.error(err.message || err);
  return res.status(status).json({ error: err.publicMessage || err.message || "Request failed" });
}
function newOrderId() {
  return "HT-" + new Date().toISOString().slice(0,10).replaceAll("-","") + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}
app.get("/api/health", (req,res) => res.json({ ok:true, paymentConfigured: configReady() }));

app.post("/api/payments/create-order", async (req,res) => {
  try {
    const { razorpay, supabase } = clients();
    const { items, customer } = req.body || {};
    if (!Array.isArray(items) || items.length < 1 || items.length > 30) return res.status(400).json({error:"Cart is empty or too large."});
    const fields = ["name","phone","address","city","state","pin"];
    if (!customer || fields.some(k => typeof customer[k] !== "string" || !customer[k].trim())) return res.status(400).json({error:"Please complete all delivery fields."});
    if (!/^\d{6}$/.test(customer.pin)) return res.status(400).json({error:"Enter a valid 6-digit PIN code."});
    const clean = [];
    for (const item of items) {
      const id = Number(item.id), qty = Number(item.qty);
      if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 20) return res.status(400).json({error:"Invalid cart item."});
      clean.push({id,qty});
    }
    const uniqueIds = [...new Set(clean.map(x=>x.id))];
    const { data: products, error: productError } = await supabase.from("products").select("id,name,price,active").in("id", uniqueIds);
    if (productError) throw productError;
    const byId = new Map((products || []).map(p=>[Number(p.id),p]));
    if (uniqueIds.some(id=>!byId.has(id) || byId.get(id).active === false)) return res.status(400).json({error:"A product is unavailable. Refresh your cart and try again."});
    const orderItems = clean.map(i => ({id:i.id,name:byId.get(i.id).name,price:Number(byId.get(i.id).price),qty:i.qty}));
    const total = orderItems.reduce((s,i)=>s+i.price*i.qty,0);
    if (!Number.isFinite(total) || total <= 0 || total > 1000000) return res.status(400).json({error:"Order total is invalid."});
    const orderId = newOrderId();
    const rpOrder = await razorpay.orders.create({amount:Math.round(total*100),currency:"INR",receipt:orderId,notes:{store_order_id:orderId}});
    const row = {
      order_id:orderId, customer_username:String(customer.customerUsername || "").slice(0,120),
      customer_name:customer.name.trim().slice(0,100), phone:customer.phone.trim().slice(0,30),
      address:customer.address.trim().slice(0,250), city:customer.city.trim().slice(0,100),
      state:customer.state.trim().slice(0,100), pin:customer.pin.trim(),
      items:orderItems, total_inr:total, payment_status:"created", order_status:"Pending",
      payment_provider:"razorpay", razorpay_order_id:rpOrder.id
    };
    const { error: insertError } = await supabase.from("orders").insert(row);
    if (insertError) throw insertError;
    res.json({keyId:process.env.RAZORPAY_KEY_ID,razorpayOrderId:rpOrder.id,amount:rpOrder.amount,currency:rpOrder.currency,orderId});
  } catch (err) { fail(res,err,err.message && err.message.includes("setup incomplete") ? 503 : 500); }
});

app.post("/api/payments/verify", async (req,res) => {
  try {
    const { supabase } = clients();
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (![orderId,razorpay_order_id,razorpay_payment_id,razorpay_signature].every(v=>typeof v==="string" && v.length>0)) return res.status(400).json({error:"Missing payment verification fields."});
    const { data: order, error: findError } = await supabase.from("orders").select("order_id,razorpay_order_id,payment_status").eq("order_id",orderId).maybeSingle();
    if (findError) throw findError;
    if (!order || order.razorpay_order_id !== razorpay_order_id) return res.status(404).json({error:"Order not found."});
    const expected = crypto.createHmac("sha256",process.env.RAZORPAY_KEY_SECRET).update(razorpay_order_id+"|"+razorpay_payment_id).digest("hex");
    const a=Buffer.from(expected), b=Buffer.from(razorpay_signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return res.status(400).json({verified:false,error:"Payment signature could not be verified."});
    const { error: updateError } = await supabase.from("orders").update({payment_status:"paid",razorpay_payment_id,paid_at:new Date().toISOString()}).eq("order_id",orderId);
    if (updateError) throw updateError;
    res.json({verified:true,orderId});
  } catch (err) { fail(res,err,500); }
});


app.post("/api/orders/track", async (req,res) => {
  try {
    const { supabase } = clients();
    const orderId = String((req.body||{}).orderId||"").trim().toUpperCase();
    const phone = String((req.body||{}).phone||"").replace(/[^\d]/g,"");
    if (!orderId || phone.length < 10) return res.status(400).json({error:"Enter your Order ID and checkout phone number."});
    const { data, error } = await supabase.from("orders").select("order_id,phone,total_inr,payment_status,order_status,created_at").eq("order_id",orderId).maybeSingle();
    if (error) throw error;
    if (!data || String(data.phone||"").replace(/[^\d]/g,"") !== phone) return res.status(404).json({error:"Order not found. Check the Order ID and phone number."});
    res.json({orderId:data.order_id,total:Number(data.total_inr),paymentStatus:data.payment_status,orderStatus:data.order_status,createdAt:data.created_at});
  } catch(err) { fail(res,err,500); }
});

// Razorpay webhook endpoint. Configure this exact path in the Razorpay dashboard.
// Set RAZORPAY_WEBHOOK_SECRET and subscribe to payment.captured / payment.failed.
app.post("/api/webhooks/razorpay", async (req,res) => {
  try {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) return res.status(503).send("Webhook secret not configured");
    const signature=req.header("x-razorpay-signature") || "";
    const expected=crypto.createHmac("sha256",process.env.RAZORPAY_WEBHOOK_SECRET).update(req.rawBody || Buffer.from("")).digest("hex");
    const a=Buffer.from(expected), b=Buffer.from(signature);
    if (a.length!==b.length || !crypto.timingSafeEqual(a,b)) return res.status(400).send("Invalid signature");
    const event=JSON.parse((req.rawBody || Buffer.from("{}")).toString("utf8"));
    const payment=event.payload && event.payload.payment && event.payload.payment.entity;
    const orderId=payment && payment.notes && payment.notes.store_order_id;
    if (orderId && ["payment.captured","payment.failed"].includes(event.event)) {
      const { supabase }=clients();
      const update=event.event==="payment.captured"
        ? {payment_status:"paid",razorpay_payment_id:payment.id,paid_at:new Date().toISOString()}
        : {payment_status:"failed",razorpay_payment_id:payment.id};
      const {error}=await supabase.from("orders").update(update).eq("order_id",orderId);
      if(error) throw error;
    }
    res.json({received:true});
  } catch(err) { fail(res,err,400); }
});

app.use((req,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`HT COLLECTION server listening on port ${PORT}`));
