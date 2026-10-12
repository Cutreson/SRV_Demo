-- 002: administrator role + session invalidation.
--  * profiles.role accepts 'admin' (system administrator: manages accounts, has no reminders / is not assignable).
--  * profiles.session_version lets a password reset invalidate the cookies that were issued with the old password.
-- One ALTER so the change is applied atomically. The new CHECK gets a new name (v2) to avoid a same-name drop+add clash.

ALTER TABLE `profiles`
  DROP CONSTRAINT `chk_profiles_role`,
  ADD CONSTRAINT `chk_profiles_role_v2` CHECK (`role` IN ('admin','director','secretary')),
  ADD COLUMN `session_version` INT NOT NULL DEFAULT 1;
