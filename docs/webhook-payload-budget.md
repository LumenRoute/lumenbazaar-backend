# Webhook payload budget

Webhook JSON is limited to 16 KiB measured as UTF-8 after serialization. No fields
are truncated, including optional failure evidence. Oversized events throw
WebhookPayloadTooLarge before storage/listener enqueueing. Workers also reject
legacy oversized jobs with errorClass WebhookPayloadTooLarge and shouldRetry false,
before signing or sending. Operators must monitor event emission failures and
delivery attempt errorClass; correct the source data rather than retry unchanged.
