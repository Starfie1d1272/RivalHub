ALTER TABLE "community_awards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "community_award_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "match_commentators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "post_match_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "community_awards", "community_award_evidence", "match_commentators", "post_match_reports" FROM anon, authenticated;
