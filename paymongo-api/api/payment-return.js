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
// docs push toward webhooks for exactly this reason, which this app
// deliberately doesn't use). To avoid mistaking that timing gap for a
// cancelled payment, this retries the status check a few times with a short
// delay before giving up.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = async function handler(req, res) {
  const { amount, pi } = req.query;

  const redirectTo = (url) => {
    res.writeHead(302, { Location: url });
    res.end();
  };

  if (!pi) {
    console.log("payment-return: no payment intent id in query, redirecting to cancel");
    return redirectTo("rentwise://payment-cancel");
  }

  const successUrl = `rentwise://payment-success?amount=${amount}&pi=${pi}`;
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  const encoded = Buffer.from(`${secretKey}:`).toString("base64");

  try {
    let status = null;

    for (let attempt = 1; attempt <= 4; attempt++) {
      const intentRes = await fetch(
        `https://api.paymongo.com/v1/payment_intents/${pi}`,
        { headers: { Authorization: `Basic ${encoded}` } },
      );

      if (!intentRes.ok) {
        console.log(`payment-return: status check HTTP ${intentRes.status} on attempt ${attempt}, falling back to success`);
        return redirectTo(successUrl);
      }

      const intent = await intentRes.json();
      status = intent.data.attributes.status;
      console.log(`payment-return: pi=${pi} attempt=${attempt} status=${status}`);

      if (status === "succeeded" || status === "processing") {
        return redirectTo(successUrl);
      }
      if (status === "awaiting_payment_method") {
        // Definitively failed/declined — no point retrying.
        break;
      }
      // status is "awaiting_next_action" (or similar transitional state) —
      // PayMongo's backend likely hasn't caught up yet, give it a moment.
      if (attempt < 4) await sleep(1500);
    }

    console.log(`payment-return: pi=${pi} gave up after retries, final status=${status}, redirecting to cancel`);
    return redirectTo("rentwise://payment-cancel");
  } catch (err) {
    console.error("payment-return status check error:", err);
    return redirectTo(successUrl);
  }
};
