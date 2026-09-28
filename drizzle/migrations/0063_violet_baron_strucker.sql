-- rivalhub:migration-risk: locking-reviewed Additive spectator read index; transaction holds a table write lock during index build, deploy through the protected migration rehearsal and release gate.
CREATE INDEX "prediction_ledger_season_account_idx" ON "prediction_ledger" USING btree ("season_id","account_id");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive spectator read index; transaction holds a table write lock during index build, deploy through the protected migration rehearsal and release gate.
CREATE INDEX "prediction_markets_season_deadline_idx" ON "prediction_markets" USING btree ("season_id","deadline");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive spectator read index; transaction holds a table write lock during index build, deploy through the protected migration rehearsal and release gate.
CREATE INDEX "prediction_picks_latest_by_account_idx" ON "prediction_picks" USING btree ("season_id","account_id","contest_id","submitted","version" DESC);--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive spectator read index; transaction holds a table write lock during index build, deploy through the protected migration rehearsal and release gate.
CREATE INDEX "prediction_stakes_season_market_option_idx" ON "prediction_stakes" USING btree ("season_id","market_id","option_id");
