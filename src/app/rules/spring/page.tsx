import type { Metadata } from "next";
import { SpringHistoricalRules } from "@/components/rules/SpringHistoricalRules";

export const metadata: Metadata = { title: "历史规则 | NJU Rivals 2026 Spring" };

export default function SpringRulesArchivePage() { return <SpringHistoricalRules />; }
