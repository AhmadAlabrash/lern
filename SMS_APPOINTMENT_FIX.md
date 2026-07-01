# SMS appointment.requested fix

This patch fixes SMS delivery for appointment-requested webhooks where the caller phone is inside:

```json
{
  "data": {
    "call": {
      "fromNumber": "+4917662410040"
    }
  }
}
```

The previous extractor checked `data.fromNumber`, but not `data.call.fromNumber`, so SMS delivery was skipped as `missing_phone` even though the webhook returned HTTP 200.

Also check these admin settings after deploying:

1. User has **SMS follow-up to caller** enabled.
2. User plan is **Pro** or **Ultimate**. The Free plan default SMS limit is `0`.
3. SMS routing contains `appointment.requested`.
4. Twilio Account SID, Auth Token and Messaging Service SID are configured.
5. Booking URL is set if your SMS template includes `{booking_url}`.

Remember: HTTP 200 means the webhook was accepted. SMS can still be skipped or fail, and the app logs that instead of returning a webhook error to prevent retries.
