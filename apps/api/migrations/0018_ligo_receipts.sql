ALTER TABLE ligo_cloud_messages ADD COLUMN delivered_at INTEGER;
ALTER TABLE ligo_cloud_messages ADD COLUMN read_at INTEGER;

-- Before receipts existed, an absent delivery row meant that the recipient
-- had already downloaded the message. Read state cannot be reconstructed.
UPDATE ligo_cloud_messages AS messages
   SET delivered_at = messages.created_at
 WHERE NOT EXISTS (
   SELECT 1 FROM ligo_deliveries AS deliveries
    WHERE deliveries.id = messages.id
 );
