create index if not exists phone_recovery_device_id_idx
  on private.phone_subscription_recovery_challenges (device_id);
