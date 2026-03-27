const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

const LIPILA_API_KEY = process.env.LIPILA_API_KEY || "YOUR_API_KEY";
const LIPILA_BASE_URL = "https://api.lipila.dev/api/v1";

const CALLBACK_URL = process.env.CALLBACK_URL || "https://your-server.com/api/payments/callback";
const BACK_URL = process.env.BACK_URL || "https://your-site.com/payment-cancelled";
const REDIRECT_URL = process.env.REDIRECT_URL || "https://your-site.com/payment-success";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post("/api/payments/mobile-money", async (req, res) => {
  const { accountNumber, amount, narration, currency, email, referenceId } = req.body;

  if (!accountNumber || !amount) {
    return res.status(400).json({
      success: false,
      error: "BAD REQUEST",
      message: "accountNumber and amount are required",
    });
  }

  const txReferenceId = referenceId || uuidv4().replace(/-/g, "").slice(0, 12);

  const payload = {
    referenceId: txReferenceId,
    amount: Number(amount),
    narration: narration || "Deposit",
    accountNumber: String(accountNumber),
    currency: currency || "ZMW",
    ...(email && { email }),
  };

  try {
    const response = await fetch(`${LIPILA_BASE_URL}/collections/mobile-money`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": LIPILA_API_KEY,
        callbackUrl: CALLBACK_URL,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data.error || "LIPILA_ERROR",
        message: data.message || "Failed to initiate mobile money payment",
        details: data,
      });
    }

    return res.status(200).json({
      success: true,
      referenceId: txReferenceId,
      currency: data.currency,
      amount: data.amount,
      accountNumber: data.accountNumber,
      status: data.status,
      paymentType: data.paymentType,
      identifier: data.identifier,
      message: data.message || "Transaction initiated successfully",
      createdAt: data.createdAt,
      cardRedirectionUrl: data.cardRedirectionUrl || null,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "SERVER_ERROR",
      message: "Internal server error while contacting Lipila",
      details: err.message,
    });
  }
});

app.post("/api/payments/card", async (req, res) => {
  const {
    firstName,
    lastName,
    phoneNumber,
    email,
    city,
    country,
    address,
    zip,
    amount,
    accountNumber,
    currency,
    narration,
    referenceId,
  } = req.body;

  const required = { firstName, lastName, phoneNumber, email, city, country, address, zip, amount, accountNumber };
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    return res.status(400).json({
      success: false,
      error: "BAD REQUEST",
      message: `Missing required fields: ${missing.join(", ")}`,
    });
  }

  const txReferenceId = referenceId || uuidv4().replace(/-/g, "").slice(0, 12);

  const payload = {
    customerInfo: {
      firstName,
      lastName,
      phoneNumber: String(phoneNumber),
      city,
      country,
      address,
      zip,
      email,
    },
    collectionRequest: {
      referenceId: txReferenceId,
      amount: Number(amount),
      narration: narration || "Card Deposit",
      accountNumber: String(accountNumber),
      currency: currency || "ZMW",
      backUrl: BACK_URL,
      redirectUrl: REDIRECT_URL,
    },
  };

  try {
    const response = await fetch(`${LIPILA_BASE_URL}/collections/card`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": LIPILA_API_KEY,
        callbackUrl: CALLBACK_URL,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data.error || "LIPILA_ERROR",
        message: data.message || "Failed to initiate card payment",
        details: data,
      });
    }

    return res.status(200).json({
      success: true,
      referenceId: txReferenceId,
      currency: data.currency,
      amount: data.amount,
      accountNumber: data.accountNumber,
      status: data.status,
      paymentType: data.paymentType,
      identifier: data.identifier,
      cardRedirectionUrl: data.cardRedirectionUrl || null,
      message: data.cardRedirectionUrl
        ? "Card payment initiated. Redirect the user to cardRedirectionUrl to complete payment."
        : "Card payment initiated",
      createdAt: data.createdAt,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "SERVER_ERROR",
      message: "Internal server error while contacting Lipila",
      details: err.message,
    });
  }
});

app.get("/api/payments/status", async (req, res) => {
  const { referenceId } = req.query;

  if (!referenceId) {
    return res.status(400).json({
      success: false,
      error: "BAD REQUEST",
      message: "referenceId query parameter is required",
    });
  }

  try {
    const response = await fetch(
      `${LIPILA_BASE_URL}/collections/check-status?referenceId=${encodeURIComponent(referenceId)}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-api-key": LIPILA_API_KEY,
        },
      }
    );

    const data = await response.json();

    if (response.status === 404) {
      return res.status(404).json({
        success: false,
        error: "NOT FOUND",
        message: `No transaction found with referenceId: ${referenceId}`,
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data.error || "LIPILA_ERROR",
        message: data.message || "Failed to retrieve transaction status",
        details: data,
      });
    }

    return res.status(200).json({
      success: true,
      referenceId: data.referenceId,
      currency: data.currency,
      amount: data.amount,
      accountNumber: data.accountNumber,
      status: data.status,
      paymentType: data.paymentType,
      type: data.type,
      identifier: data.identifier,
      externalId: data.externalId || null,
      message: data.message,
      ipAddress: data.ipAddress,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "SERVER_ERROR",
      message: "Internal server error while checking transaction status",
      details: err.message,
    });
  }
});

app.post("/api/payments/callback", (req, res) => {
  const payload = req.body;

  const {
    referenceId,
    currency,
    amount,
    accountNumber,
    status,
    paymentType,
    type,
    ipAddress,
    identifier,
    message,
    externalId,
  } = payload;

  console.log("[Lipila Callback] Received payment notification:", {
    referenceId,
    status,
    paymentType,
    amount,
    currency,
    accountNumber,
    type,
    identifier,
    message,
    externalId,
    ipAddress,
  });

  if (status === "Successful") {
    console.log(`[Lipila Callback] Payment SUCCESSFUL — referenceId: ${referenceId}, amount: ${amount} ${currency}, method: ${paymentType}`);
  } else if (status === "Failed") {
    console.log(`[Lipila Callback] Payment FAILED — referenceId: ${referenceId}, reason: ${message}, method: ${paymentType}`);
  } else {
    console.log(`[Lipila Callback] Payment status: ${status} — referenceId: ${referenceId}`);
  }

  return res.status(200).json({ received: true });
});

app.get("/api/payments/methods", (_req, res) => {
  return res.status(200).json({
    success: true,
    paymentMethods: [
      {
        id: "airtel_money",
        name: "Airtel Money",
        type: "mobile_money",
        paymentType: "AirtelMoney",
        description: "Pay using your Airtel Money wallet",
        prefix: ["097", "096"],
      },
      {
        id: "mtn_money",
        name: "MTN Money",
        type: "mobile_money",
        paymentType: "MtnMoney",
        description: "Pay using your MTN Mobile Money wallet. If prompt is delayed, dial *115#",
        prefix: ["096", "076"],
      },
      {
        id: "zamtel_kwacha",
        name: "Zamtel Kwacha",
        type: "mobile_money",
        paymentType: "ZamtelKwacha",
        description: "Pay using your Zamtel Kwacha wallet",
        prefix: ["095"],
      },
      {
        id: "visa_mastercard",
        name: "Visa / Mastercard",
        type: "card",
        paymentType: "Card",
        description: "Pay using your Visa or Mastercard",
        brands: ["Visa", "Mastercard"],
      },
    ],
  });
});

app.get("/api/healthz", (_req, res) => {
  return res.status(200).json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Lipila Payment Server running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  POST /api/payments/mobile-money   — Initiate MoMo payment (Airtel, MTN, Zamtel)`);
  console.log(`  POST /api/payments/card            — Initiate Visa/Mastercard payment`);
  console.log(`  GET  /api/payments/status          — Check transaction status (?referenceId=...)`);
  console.log(`  POST /api/payments/callback        — Lipila callback receiver`);
  console.log(`  GET  /api/payments/methods         — List supported payment methods`);
  console.log(`  GET  /api/healthz                  — Health check`);
});
