// PayMongo's Payment Intents `attach` endpoint requires a real http(s)
// return_url (unlike Checkout Sessions, which accepted our rentwise://
// custom scheme directly), and only supports ONE return_url for both
// success and cancellation — there's no separate cancel_url like Checkout
// Sessions had. This endpoint is that http(s) return_url: it checks the
// intent's actual status, then 302-redirects to the appropriate rentwise://
// deep link, which the app's existing WebView interception already handles.
//
// PayMongo can redirect back here slightly before its own backend has
// finished flipping the intent's status to "succeeded"/"processing" (their
// docs push toward webhooks for exactly this reason. The backend webhook and
// authenticated app reconciliation are authoritative; this return route is
// only a fast status hint. To avoid mistaking that timing gap for a
// cancelled payment, this retries the status check a few times with a short
// delay before giving up.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = async function handler(req, res) {
  const { amount, pi } = req.query;

  const redirectTo = (url) => {
    res.writeHead(302, { Location: url });
    res.end();
  };

  if (typeof pi !== "string" || !/^pi_[A-Za-z0-9_-]+$/.test(pi) || pi.length > 200) {
    console.log("payment-return: invalid payment intent id, redirecting to pending");
    return redirectTo("rentwise:///payment-success?returnStatus=pending&amount=0");
  }

  const safeAmount = typeof amount === "string" && /^\d+$/.test(amount) ? amount : "0";
  // Three slashes are required here: `rentwise:///payment-success` maps to
  // Expo Router's /payment-success path. With only two slashes, Android
  // treats `payment-success` as the URL host and Expo opens an unmatched
  // route. Every provider outcome goes through the same reconciliation
  // screen; `returnStatus` is only a hint and the backend remains authoritative.
  const appUrl = (status) =>
    `rentwise:///payment-success?returnStatus=${encodeURIComponent(status)}` +
    `&amount=${safeAmount}&pi=${encodeURIComponent(pi)}`;
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey) {
    console.error("payment-return: PAYMONGO_SECRET_KEY is not configured");
    return redirectTo(appUrl("pending"));
  }
  if (!secretKey.startsWith("sk_test_")) {
    console.error("payment-return: refusing to inspect a demo payment with a non-test key");
    return redirectTo(appUrl("pending"));
  }
  const encoded = Buffer.from(`${secretKey}:`).toString("base64");

  try {
    let status = null;

    for (let attempt = 1; attempt <= 4; attempt++) {
      const intentRes = await fetch(
        `https://api.paymongo.com/v1/payment_intents/${pi}`,
        { headers: { Authorization: `Basic ${encoded}` } },
      );

      if (!intentRes.ok) {
        console.log(`payment-return: status check HTTP ${intentRes.status} on attempt ${attempt}`);
        return redirectTo(appUrl("pending"));
      }

      const intent = await intentRes.json();
      status = intent.data.attributes.status;
      console.log(`payment-return: pi=${pi} attempt=${attempt} status=${status}`);

      if (status === "succeeded") {
        return redirectTo(appUrl("success"));
      }
      if (status === "processing") {
        return redirectTo(appUrl("processing"));
      }
      if (status === "cancelled") {
        return redirectTo(appUrl("cancelled"));
      }
      if (status === "awaiting_payment_method") {
        // A last_payment_error can be transient while the wallet result is
        // settling. The authenticated backend reconciliation decides whether
        // it is terminal; the browser return must stay neutral.
        return redirectTo(appUrl("pending"));
      }
      // status is "awaiting_next_action" (or similar transitional state) —
      // PayMongo's backend likely hasn't caught up yet, give it a moment.
      if (attempt < 4) await sleep(1500);
    }

    console.log(`payment-return: pi=${pi} remains unresolved after retries, final status=${status}`);
    return redirectTo(appUrl("pending"));
  } catch (err) {
    console.error("payment-return status check error:", err);
    return redirectTo(appUrl("pending"));
  }
};
